import * as vscode from "vscode";
import { createHash } from "node:crypto";
import { AiClient } from "./aiClient";
import { ContextMode, getCodeContext } from "./contextExtractor";
import { buildPrompt } from "./promptBuilder";
import { newProfile, ProfileRepository, ProviderProfile } from "./profiles";
import { buildFollowUpPrompt, ConversationTurn } from "./conversation";
import { HistoryEntry, HistoryRepository, historyAsMarkdown } from "./history";
import { GenerationUsage } from "./aiStream";
import { formatUsage } from "./usage";
import {
  CodeContext,
  ExplanationMode,
  ExplanationSection,
  ExtensionConfig,
  getProviderLabel,
  LastExplanationState,
  ModelProvider,
  ModelSettingsInput,
  ProviderConnectionStatus,
  UiLanguage
} from "./types";
import { ExplanationPanel, PanelMessage } from "./webviewPanel";

type CopySection = "summary" | "details" | "takeaway";

let lastExplanationState: LastExplanationState | undefined;
let lastAttemptContext: CodeContext | undefined;
let lastAttemptMode: ExplanationMode = "quick";
let latestProviderStatus: ProviderConnectionStatus | undefined;
let checkedProfileSignature: string | undefined;
let generationVerified = false;
let generationId = 0;
let activeGeneration: AbortController | undefined;
let profileRepository: ProfileRepository;
let initialExplanation = "";
let conversation: ConversationTurn[] = [];
let lastAttemptQuestion: string | undefined;
const confirmedContexts = new Set<string>();
let historyRepository: HistoryRepository;
let currentHistoryId: string | undefined;

const outputBudgets = { short: 1024, medium: 2048, long: 4096 } as const;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const aiClient = new AiClient();
  profileRepository = new ProfileRepository(context.globalState, context.secrets);
  historyRepository = new HistoryRepository(context.globalState);
  const legacy = getConfig();
  await profileRepository.migrate({ name: getProviderLabel(legacy.provider), provider: legacy.provider,
    endpoint: endpointFor(legacy), model: legacy.model, timeoutSeconds: legacy.timeoutSeconds });
  const panel = new ExplanationPanel(context.extensionUri, async (message: PanelMessage) => {
    const action = message.action;

    if (!action) {
      return;
    }

    if (action === "cancelGeneration") {
      activeGeneration?.abort();
      return;
    }
    if (action === "streamReady") {
      panel.sendStreamSnapshot();
      return;
    }
    if (action === "questionDraft") {
      panel.setQuestionDraft(message.question ?? "");
      return;
    }

    if (action.startsWith("copy:")) {
      const section = action.slice("copy:".length) as CopySection;
      const text = panel.getLatestSectionText(section);

      if (!text) {
        vscode.window.showInformationMessage(localize(getConfig().language, "noExplanationToCopy"));
        return;
      }

      await vscode.env.clipboard.writeText(text);
      vscode.window.showInformationMessage(localize(getConfig().language, "sectionCopied"));
      return;
    }

    if (action === "moreSimple") {
      await vscode.commands.executeCommand("explainCode.explainMoreSimply");
      return;
    }

    if (action === "moreDetailed") {
      await vscode.commands.executeCommand("explainCode.explainInMoreDetail");
      return;
    }

    if ((action === "askQuestion" || action === "example") && lastExplanationState) {
      const question = action === "example" ? (getConfig().language === "fr" ? "Donne-moi un exemple concret pour ce code." : "Give me a concrete example for this code.") : message.question?.trim();
      if (question && question.length <= 4000) await explainFromContext(lastExplanationState.codeContext, "quick", panel, aiClient, question);
      return;
    }

    if (action === "retry") {
      if (!lastAttemptContext) {
        vscode.window.showInformationMessage(localize(getConfig().language, "nothingToRetry"));
        return;
      }

      await explainFromContext(lastAttemptContext, lastAttemptMode, panel, aiClient, lastAttemptQuestion);
      return;
    }

    if (action === "settings") {
      await showSettings(panel, aiClient);
      return;
    }

    if (action === "profiles") {
      try {
        await manageProfiles();
        await showSettings(panel, aiClient);
      } catch (error) {
        handleError(error);
      }
      return;
    }

    if (action === "history") {
      try { await manageHistory(panel); } catch (error) { handleError(error); }
      return;
    }

    if (action === "setExplanationSections") {
      await updateExplanationSections(message.explanationSections);
      return;
    }

    if (action === "listModels" && message.settings) {
      const settings = message.settings;
      const preview = buildConfigFromSettings(settings);
      try {
        const current = getConfig();
        const changed = preview.provider === "openai" && hasEndpointChanged(current.openAiBaseUrl, preview.openAiBaseUrl)
          ? [localize(preview.language, "openAiEndpointLabel")]
          : preview.provider === "anthropic" && hasEndpointChanged(current.anthropicBaseUrl, preview.anthropicBaseUrl)
            ? [localize(preview.language, "anthropicEndpointLabel")] : [];
        if (changed.length && !(await confirmEndpointSettingsChange(preview.language, changed))) {
          panel.sendModels(message.requestId, [], localize(preview.language, "settingsChangeCanceled"));
          return;
        }
        const key = await keyForSettings(settings, preview);
        const models = await aiClient.listModels(preview, key);
        panel.sendModels(message.requestId, models);
      } catch (error) {
        panel.sendModels(message.requestId, [], error instanceof Error ? error.message : "Error");
      }
      return;
    }

    if (action === "checkSettingsConnection") {
      await checkSettingsConnection(panel, aiClient, message.settings, message.requestId);
      return;
    }
    if (action === "testGeneration") {
      await testSettingsGeneration(panel, aiClient, message.settings, message.requestId);
      return;
    }

    if (action === "cancelSettings") {
      if (lastExplanationState) {
        panel.showExplanation(
          lastExplanationState,
          getConfig().language,
          getConfig().explanationSections
        );
        return;
      }

      panel.showEmptyState(getConfig().language, getConfig().explanationSections);
      return;
    }

    if (action === "saveSettings") {
      try {
        const saved = await saveSettings(message.settings, aiClient);

        if (saved) {
          await showSettings(panel, aiClient);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : localize(getConfig().language, "unknownError");
        vscode.window.showErrorMessage(message);
      }
    }
  }, () => {
    const profile = activeProfile();
    const language = getConfig().language;
    const checked = checkedProfileSignature === profileSignature(profile) && latestProviderStatus?.kind === "success";
    return `${profile.name} · ${profile.model || (language === "fr" ? "Modèle à choisir" : "Choose a model")} · ${checked ? (generationVerified ? (language === "fr" ? "Génération vérifiée" : "Generation verified") : (language === "fr" ? "Catalogue vérifié" : "Catalog checked")) : (language === "fr" ? "Connexion non vérifiée" : "Connection unchecked")}`;
  });

  const statusBarItem = createStatusBarItem();

  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand("explainCode.openPanel", async () => {
      if (lastExplanationState) {
        panel.showExplanation(lastExplanationState, getConfig().language, getConfig().explanationSections);
      } else {
        panel.showEmptyState(getConfig().language, getConfig().explanationSections);
      }
    }),

    vscode.commands.registerCommand("explainCode.explainSelection", async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showInformationMessage(localize(getConfig().language, "openFileAndSelectCode"));
        return;
      }

      try {
        const config = getConfig();
        const codeContext = await getCodeContext(editor, config, true);
        await explainFromContext(codeContext, "quick", panel, aiClient);
      } catch (error) {
        handleError(error);
      }
    }),

    vscode.commands.registerCommand("explainCode.explainAtCursor", async () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor) {
        vscode.window.showInformationMessage(localize(getConfig().language, "openFileForCursorExplain"));
        return;
      }

      try {
        const config = getConfig();
        const codeContext = await getCodeContext(editor, config, false);
        await explainFromContext(codeContext, "quick", panel, aiClient);
      } catch (error) {
        handleError(error);
      }
    }),

    vscode.commands.registerCommand("explainCode.explainWithContext", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showInformationMessage(localize(getConfig().language, "openFileForCursorExplain")); return; }
      const choices: Array<{ label: string; description: string; mode: ContextMode }> = [
        { label: "Sélection", description: "Code sélectionné", mode: "selection" },
        { label: "Ligne actuelle", description: "Ligne sous le curseur", mode: "line" },
        { label: "Fonction ou méthode", description: "Symbole contenant le curseur", mode: "function" },
        { label: "Classe", description: "Classe contenant le curseur", mode: "class" },
        { label: "Fichier", description: "Fichier entier dans la limite de taille", mode: "file" }
      ];
      const choice = await vscode.window.showQuickPick(choices, { title: "Contexte à expliquer" });
      if (!choice) return;
      try {
        const context = await getCodeContext(editor, getConfig(), choice.mode === "selection", choice.mode);
        await explainFromContext(context, "quick", panel, aiClient);
      } catch (error) { handleError(error); }
    }),

    vscode.commands.registerCommand("explainCode.explainMoreSimply", async () => {
      if (!lastExplanationState) {
        vscode.window.showInformationMessage(localize(getConfig().language, "nothingToSimplify"));
        return;
      }

      await explainFromContext(lastExplanationState.codeContext, "simple", panel, aiClient,
        getConfig().language === "fr" ? "Explique ta réponse précédente plus simplement." : "Explain your previous answer more simply.");
    }),

    vscode.commands.registerCommand("explainCode.explainInMoreDetail", async () => {
      if (!lastExplanationState) {
        vscode.window.showInformationMessage(localize(getConfig().language, "nothingToDetail"));
        return;
      }

      await explainFromContext(lastExplanationState.codeContext, "detailed", panel, aiClient,
        getConfig().language === "fr" ? "Approfondis ta réponse précédente et explique les points importants." : "Expand on your previous answer and explain the important points.");
    }),

    vscode.commands.registerCommand("explainCode.openSettings", async () => {
      await showSettings(panel, aiClient);
    }),

    vscode.commands.registerCommand("explainCode.checkOllama", async () => {
      const config = getConfig();

      try {
        const key = config.provider === "ollama" ? undefined : await profileRepository.getKey(activeProfile());
        if (config.provider !== "ollama" && !key) throw new Error(localize(config.language, "missingProviderKeyDetails", getProviderLabel(config.provider)));
        const status = await aiClient.checkConnection(config, key);
        const hasModel = status.models.some((modelName) =>
          modelName === config.model || modelName.startsWith(`${config.model}:`)
        );

        if (config.provider !== "ollama" || hasModel) {
          vscode.window.showInformationMessage(localize(config.language, "providerConnected"));
          return;
        }

        vscode.window.showWarningMessage(localize(config.language, "ollamaModelMissing", config.model));
      } catch (error) {
        const message = error instanceof Error ? error.message : localize(config.language, "providerNotRunning");
        vscode.window.showErrorMessage(message);
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => updateStatusBarItem(statusBarItem)),
    vscode.window.onDidChangeTextEditorSelection(() => updateStatusBarItem(statusBarItem)),
    vscode.workspace.onDidChangeTextDocument(event => {
      const current = lastExplanationState;
      if (!current || current.codeContext.filePath !== event.document.fileName) return;
      void getSourceStatus(current.codeContext, getConfig().language).then(status => {
        if (current === lastExplanationState) { current.sourceStatus = status; panel.setSourceStatus(status); }
      });
    })
  );

  updateStatusBarItem(statusBarItem);
  void maybeShowFirstRunSetup(context, panel, aiClient);
}

export function deactivate(): void {}

async function explainFromContext(
  codeContext: CodeContext,
  mode: ExplanationMode,
  panel: ExplanationPanel,
  aiClient: AiClient,
  question?: string
): Promise<void> {
  activeGeneration?.abort();
  const controller = new AbortController();
  activeGeneration = controller;
  const requestId = ++generationId;
  const config = getConfig();
  const profile = activeProfile();
  const profileName = profile.name;
  lastAttemptContext = codeContext;
  lastAttemptMode = mode;
  lastAttemptQuestion = question;

  const key = config.provider === "ollama" ? undefined : await profileRepository.getKey(activeProfile());
  const hasApiKey = config.provider === "ollama" || Boolean(key);
  if (!config.model.trim()) {
    if (activeGeneration === controller) activeGeneration = undefined;
    const message = config.language === "fr" ? "Choisissez un modèle dans les paramètres du profil." : "Choose a model in the profile settings.";
    panel.showError(message, config.language, codeContext, config.explanationSections);
    vscode.window.showErrorMessage(message);
    return;
  }
  if (requestId !== generationId) return;
  if (!hasApiKey) {
    if (activeGeneration === controller) activeGeneration = undefined;
    const message = localize(config.language, "missingProviderKeyDetails", getProviderLabel(config.provider));
    panel.showError(message, config.language, codeContext, config.explanationSections);
    vscode.window.showErrorMessage(message);
    return;
  }

  const prompt = question && lastExplanationState
    ? buildFollowUpPrompt(codeContext, initialExplanation, conversation, question, config.language, config.responseStyle)
    : buildPrompt(
    {
      context: codeContext,
      responseLanguage: config.language,
      responseStyle: config.responseStyle,
      explanationSections: config.explanationSections,
      structured: !question && Boolean(profile.structuredOutput)
    },
    mode
  );

  const maxTokens = mode === "detailed" ? Math.min(8192, outputBudgets[config.responseLength] * 2) : outputBudgets[config.responseLength];
  if (!(await confirmRemoteContext(config, codeContext, prompt, maxTokens))) {
    if (activeGeneration === controller) activeGeneration = undefined;
    return;
  }
  if (requestId !== generationId || controller.signal.aborted) return;

  panel.showLoading(localize(config.language, "loadingWithProvider"), config.language, config.explanationSections, codeContext);

  try {
    const startedAt = Date.now();
    let usage: GenerationUsage = {};
    const explanation = await aiClient.generateStream(config, {
          prompt,
          maxTokens,
          signal: controller.signal,
          structured: !question && Boolean(profile.structuredOutput),
          onText: (text) => { if (requestId === generationId) panel.appendStream(text); },
          onUsage: (value) => { usage = value; }
        }, key);

    if (requestId !== generationId) return;
    const sourceStatus = await getSourceStatus(codeContext, config.language);
    if (requestId !== generationId) return;
    if (question) conversation.push({ question, answer: explanation });
    else { initialExplanation = explanation; conversation = []; currentHistoryId = undefined; }
    panel.setQuestionDraft("");
    lastExplanationState = {
      codeContext,
      explanation,
      mode,
      sourceStatus,
      usageInfo: formatUsage(usage, Date.now() - startedAt, config.language)
    };

    panel.showExplanation(
      lastExplanationState,
      config.language,
      question ? ["details"] : config.explanationSections,
      true
    );
    try {
      const preferences = vscode.workspace.getConfiguration("explainCode");
      const historyEnabled = preferences.get<boolean>("historyEnabled", false);
      const prior = historyRepository.list().find(entry => entry.id === currentHistoryId);
      const saved = await historyRepository.save({ id: currentHistoryId, context: codeContext,
        model: prior?.model ?? config.model, profileName: prior?.profileName ?? profileName,
        mode: prior?.mode ?? mode, originalExplanation: initialExplanation, turns: [...conversation], usageInfo: lastExplanationState.usageInfo },
        historyEnabled, preferences.get<number>("historyLimit", 20));
      if (requestId === generationId && saved) currentHistoryId = saved.id;
      if (historyEnabled && !saved) void vscode.window.showWarningMessage(config.language === "fr"
        ? "Historique non enregistré : le contexte semble sensible." : "History not saved: the context appears sensitive.");
    } catch {
      void vscode.window.showWarningMessage(config.language === "fr" ? "L'explication n'a pas pu être enregistrée dans l'historique local." : "The explanation could not be saved to local history.");
    }
  } catch (error) {
    if (requestId !== generationId) return;
    const message = error instanceof Error ? error.message : localize(config.language, "unknownError");
    panel.showError(message, config.language, codeContext, config.explanationSections);
    vscode.window.showErrorMessage(message);
  } finally {
    if (activeGeneration === controller) activeGeneration = undefined;
  }
}

async function showSettings(panel: ExplanationPanel, aiClient: AiClient): Promise<void> {
  const config = getConfig();

  panel.showSettings(
    {
      provider: config.provider,
      model: config.model,
      ollamaUrl: config.ollamaUrl,
      openAiBaseUrl: config.openAiBaseUrl,
      anthropicBaseUrl: config.anthropicBaseUrl,
      explanationSections: config.explanationSections,
      profileName: activeProfile().name,
      language: config.language,
      responseStyle: config.responseStyle,
      responseLength: config.responseLength,
      maxSurroundingLines: config.maxSurroundingLines,
      includeRelatedContext: config.includeRelatedContext,
      maxRelatedSnippets: config.maxRelatedSnippets,
      maxRelatedLinesPerSnippet: config.maxRelatedLinesPerSnippet,
      maxContextCharacters: config.maxContextCharacters,
      timeoutSeconds: config.timeoutSeconds,
      hasApiKey: config.provider === "ollama" || Boolean(await profileRepository.getKey(activeProfile())),
      apiKey: "",
      clearApiKey: false,
      providerStatus: (checkedProfileSignature === profileSignature(activeProfile()) ? latestProviderStatus : undefined) ?? {
        kind: "idle",
        message: localize(config.language, "providerStatusNotChecked")
      }
    },
    config.language
  );
}

async function maybeShowFirstRunSetup(
  context: vscode.ExtensionContext,
  panel: ExplanationPanel,
  aiClient: AiClient
): Promise<void> {
  const hasSeenSetup = context.globalState.get<boolean>("xplanator.hasSeenSetup", false);

  if (hasSeenSetup) {
    return;
  }

  const language = getConfig().language;
  const openSettings = localize(language, "firstRunOpenSettings");
  const later = localize(language, "firstRunLater");
  const selected = await vscode.window.showInformationMessage(
    localize(language, "firstRunSetupPrompt"),
    openSettings,
    later
  );

  await context.globalState.update("xplanator.hasSeenSetup", true);

  if (selected === openSettings) {
    await showSettings(panel, aiClient);
  }
}

async function checkSettingsConnection(
  panel: ExplanationPanel,
  aiClient: AiClient,
  settings: ModelSettingsInput | undefined,
  requestId: number | undefined
): Promise<void> {
  const previewConfig = buildConfigFromSettings(settings);
  let apiKeyOverride: string | undefined;

  try {
    generationVerified = false;
    apiKeyOverride = await keyForSettings(settings, previewConfig);
    const current = getConfig();
    const endpointChanged = previewConfig.provider === "openai" && hasEndpointChanged(current.openAiBaseUrl, previewConfig.openAiBaseUrl)
      ? [localize(previewConfig.language, "openAiEndpointLabel")]
      : previewConfig.provider === "anthropic" && hasEndpointChanged(current.anthropicBaseUrl, previewConfig.anthropicBaseUrl)
        ? [localize(previewConfig.language, "anthropicEndpointLabel")] : [];
    if (endpointChanged.length && !(await confirmEndpointSettingsChange(previewConfig.language, endpointChanged))) return;
    validateEndpointUrl(previewConfig.language, previewConfig.ollamaUrl, localize(previewConfig.language, "ollamaEndpointLabel"));
    validateEndpointUrl(previewConfig.language, previewConfig.openAiBaseUrl, localize(previewConfig.language, "openAiEndpointLabel"));
    validateEndpointUrl(previewConfig.language, previewConfig.anthropicBaseUrl, localize(previewConfig.language, "anthropicEndpointLabel"));

    if (previewConfig.provider !== "ollama" && !apiKeyOverride) {
      latestProviderStatus = {
        kind: "error",
        message: localize(previewConfig.language, "missingProviderKeyDetails", getProviderLabel(previewConfig.provider))
      };
    } else {
      const status = await aiClient.checkConnection(previewConfig, apiKeyOverride);
      const found = status.models.some(name => name === previewConfig.model ||
        (previewConfig.provider === "ollama" && name === `${previewConfig.model}:latest`));
      const successMessage = previewConfig.language === "fr"
        ? found ? "Catalogue accessible et modèle présent. Génération non vérifiée." : "Catalogue accessible, mais modèle absent de la liste reçue. Génération non vérifiée."
        : found ? "Catalog accessible and model listed. Generation not verified." : "Catalog accessible, but the model was not listed. Generation not verified.";

      latestProviderStatus = {
        kind: "success",
        message: successMessage
      };
    }
  } catch (error) {
    latestProviderStatus = {
      kind: "error",
      message: error instanceof Error ? error.message : localize(previewConfig.language, "providerStatusFailed")
    };
  }

  const currentProfile = activeProfile();
  checkedProfileSignature = !settings?.apiKey?.trim() && !settings?.clearApiKey && previewConfig.provider === currentProfile.provider &&
    previewConfig.model === currentProfile.model && !hasEndpointChanged(endpointFor(previewConfig), currentProfile.endpoint)
    ? profileSignature(currentProfile) : undefined;

  if (latestProviderStatus) panel.sendConnectionStatus(latestProviderStatus, requestId);
}

async function testSettingsGeneration(panel: ExplanationPanel, aiClient: AiClient, settings: ModelSettingsInput | undefined, requestId: number | undefined): Promise<void> {
  const preview = buildConfigFromSettings(settings);
  const destination = endpointFor(preview);
  const accepted = await vscode.window.showWarningMessage(
    preview.language === "fr" ? `Tester la génération avec ${preview.model || "ce profil"} ?` : `Test generation with ${preview.model || "this profile"}?`,
    { modal: true, detail: preview.language === "fr" ? `Une courte requête sera envoyée à ${destination}. Elle peut être facturée.` : `A short request will be sent to ${destination}. It may be billed.` },
    preview.language === "fr" ? "Tester" : "Test"
  );
  if (!accepted) return;
  try {
    if (!preview.model.trim()) throw new Error(preview.language === "fr" ? "Choisissez un modèle." : "Choose a model.");
    const key = await keyForSettings(settings, preview);
    await aiClient.generateStream(preview, { prompt: "Reply with OK.", maxTokens: 128,
      signal: new AbortController().signal, onText: () => {} }, key);
    latestProviderStatus = { kind: "success", message: preview.language === "fr" ? "Génération de test réussie. Cette requête peut être facturée." : "Test generation succeeded. This request may be billed." };
    generationVerified = true;
  } catch (error) {
    generationVerified = false;
    latestProviderStatus = { kind: "error", message: error instanceof Error ? error.message : localize(preview.language, "providerStatusFailed") };
  }
  const current = activeProfile();
  checkedProfileSignature = !settings?.apiKey?.trim() && !settings?.clearApiKey && preview.provider === current.provider &&
    preview.model === current.model && !hasEndpointChanged(destination, current.endpoint) ? profileSignature(current) : undefined;
  panel.sendConnectionStatus(latestProviderStatus, requestId);
}

async function showSettingsDraft(
  panel: ExplanationPanel,
  aiClient: AiClient,
  settings: ModelSettingsInput | undefined,
  language: UiLanguage
): Promise<void> {
  const previewConfig = buildConfigFromSettings(settings);

  panel.showSettings(
    {
      provider: previewConfig.provider,
      model: previewConfig.model,
      ollamaUrl: previewConfig.ollamaUrl,
      openAiBaseUrl: previewConfig.openAiBaseUrl,
      anthropicBaseUrl: previewConfig.anthropicBaseUrl,
      explanationSections: previewConfig.explanationSections,
      profileName: activeProfile().name,
      hasApiKey: previewConfig.provider === "ollama" || Boolean(await profileRepository.getKey(activeProfile())),
      apiKey: "",
      clearApiKey: settings?.clearApiKey ?? false,
      providerStatus: latestProviderStatus ?? {
        kind: "idle",
        message: localize(language, "providerStatusNotChecked")
      }
    },
    language
  );
}

async function saveSettings(settings: ModelSettingsInput | undefined, _aiClient: AiClient): Promise<boolean> {
  if (!settings) throw new Error("Paramètres manquants.");
  const current = activeProfile();
  if (settings.provider !== current.provider) throw new Error("Créez un profil pour changer de fournisseur.");
  const preview = buildConfigFromSettings(settings);
  const actual = getConfig();
  const number = (value: number | undefined, fallback: number, min: number, max: number): number => {
    const result = value ?? fallback;
    if (!Number.isInteger(result) || result < min || result > max) throw new Error(`Valeur hors limites : ${min}–${max}.`);
    return result;
  };
  const timeoutSeconds = number(settings.timeoutSeconds, current.timeoutSeconds, 5, 180);
  const preferences = {
    language: settings.language ?? actual.language,
    responseStyle: settings.responseStyle ?? actual.responseStyle,
    responseLength: settings.responseLength ?? actual.responseLength,
    maxSurroundingLines: number(settings.maxSurroundingLines, actual.maxSurroundingLines, 10, 200),
    includeRelatedContext: settings.includeRelatedContext ?? actual.includeRelatedContext,
    maxRelatedSnippets: number(settings.maxRelatedSnippets, actual.maxRelatedSnippets, 0, 8),
    maxRelatedLinesPerSnippet: number(settings.maxRelatedLinesPerSnippet, actual.maxRelatedLinesPerSnippet, 8, 80),
    maxContextCharacters: number(settings.maxContextCharacters, actual.maxContextCharacters, 4000, 120000)
  };
  if (!['fr', 'en'].includes(preferences.language) || !['beginner', 'simple', 'technical'].includes(preferences.responseStyle) ||
      !['short', 'medium', 'long'].includes(preferences.responseLength)) throw new Error("Préférences d'explication invalides.");
  const validated = newProfile({ name: current.name, provider: current.provider, model: settings.model,
    endpoint: endpointFor(preview), timeoutSeconds });
  const updated: ProviderProfile = { ...validated, id: current.id };
  if (hasEndpointChanged(current.endpoint, updated.endpoint)) {
    if (!await confirmEndpointSettingsChange(preview.language, [updated.endpoint])) return false;
  }
  // Save a new key before publishing the new destination. Keys never follow an endpoint change.
  if (settings.clearApiKey) await profileRepository.clearKey(updated);
  else if (settings.apiKey?.trim()) await profileRepository.setKey(updated, settings.apiKey);
  await profileRepository.save(updated);
  const vscodeConfig = vscode.workspace.getConfiguration("explainCode");
  for (const [key, value] of Object.entries(preferences)) await vscodeConfig.update(key, value, vscode.ConfigurationTarget.Global);
  latestProviderStatus = { kind: "idle", message: localize(preview.language, "providerStatusNotChecked") };
  checkedProfileSignature = undefined;
  vscode.window.showInformationMessage(localize(preview.language, "settingsSaved"));
  return true;
}

async function updateExplanationSections(sections: readonly string[] | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration("explainCode")
    .update("explanationSections", normalizeExplanationSections(sections), vscode.ConfigurationTarget.Global);
}

function activeProfile(): ProviderProfile {
  const state = profileRepository.read();
  const profile = state?.profiles.find(item => item.id === state.activeId);
  if (!profile) throw new Error("Aucun profil actif.");
  return profile;
}

function profileSignature(profile: ProviderProfile): string {
  return `${profile.id}\0${profile.endpoint}\0${profile.model}`;
}

function endpointFor(config: ExtensionConfig): string {
  switch (config.provider) {
    case "ollama": return config.ollamaUrl;
    case "anthropic": return config.anthropicBaseUrl;
    case "gemini": return "https://generativelanguage.googleapis.com/v1beta";
    case "meta": return "https://api.meta.ai/v1";
    case "openai": return config.openAiBaseUrl;
  }
}

async function confirmRemoteContext(config: ExtensionConfig, code: CodeContext, prompt: string, maxTokens: number): Promise<boolean> {
  const endpoint = endpointFor(config);
  const hostname = new URL(endpoint).hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return true;
  const preview = `Destination : ${endpoint}\nModèle : ${config.model}\nBudget de sortie demandé : ${maxTokens} tokens\nFichier : ${code.fileName} (${code.startLine}–${code.endLine})\n\nCONTENU ENVOYÉ AU MODÈLE\n\n${prompt}`;
  const fingerprint = createHash("sha256").update(endpoint).update(preview).digest("hex");
  if (confirmedContexts.has(fingerprint)) return true;
  while (true) {
    const selected = await vscode.window.showWarningMessage(
      `XPlanator enverra le code et le contexte à ${new URL(endpoint).host} avec ${config.model}.`,
      { modal: true, detail: "Le fournisseur peut facturer la requête et appliquer sa propre politique de conservation." },
      "Envoyer", "Aperçu du contexte"
    );
    if (selected === "Envoyer") { confirmedContexts.add(fingerprint); return true; }
    if (selected !== "Aperçu du contexte") return false;
    const document = await vscode.workspace.openTextDocument({ language: "plaintext", content: preview });
    await vscode.window.showTextDocument(document, { preview: true, preserveFocus: false });
  }
}

async function keyForSettings(settings: ModelSettingsInput | undefined, preview: ExtensionConfig): Promise<string | undefined> {
  const current = activeProfile();
  if (preview.provider !== current.provider) throw new Error("Choisissez un profil correspondant au fournisseur.");
  // Validate the draft before any network call, including local providers.
  newProfile({ name: current.name, provider: current.provider, endpoint: endpointFor(preview), model: current.model, timeoutSeconds: current.timeoutSeconds });
  if (preview.provider === "ollama") return undefined;
  const draftKey = settings?.apiKey?.trim();
  const key = draftKey || await profileRepository.getKey({ ...current, endpoint: endpointFor(preview) });
  if (!key) throw new Error(localize(preview.language, "missingProviderKeyDetails", getProviderLabel(preview.provider)));
  return key;
}

async function manageProfiles(): Promise<void> {
  const state = profileRepository.read();
  if (!state) throw new Error("Profils indisponibles.");
  const choice = await vscode.window.showQuickPick([
    ...state.profiles.map(profile => ({ label: profile.name, description: `${getProviderLabel(profile.provider)} · ${profile.model}${profile.id === state.activeId ? " · actif" : ""}`, id: profile.id })),
    { label: "$(add) Nouveau profil", description: "", id: "new" },
    { label: "$(edit) Renommer le profil actif", description: "", id: "rename" },
    { label: "$(watch) Modifier le délai du profil actif", description: "", id: "timeout" },
    { label: activeProfile().structuredOutput ? "$(json) Désactiver les réponses structurées" : "$(json) Activer les réponses structurées", description: "Compatibilité du modèle à vérifier", id: "structured" },
    { label: "$(trash) Supprimer le profil actif", description: "", id: "delete" }
  ], { title: "Profils XPlanator", placeHolder: "Choisir un profil ou une action" });
  if (!choice) return;
  if (choice.id === "rename") {
    const profile = activeProfile();
    const name = await vscode.window.showInputBox({ title: "Nom du profil", value: profile.name, ignoreFocusOut: true });
    if (name !== undefined) await profileRepository.save({ ...profile, name });
  } else if (choice.id === "structured") {
    const profile = activeProfile();
    if (!profile.structuredOutput) {
      const accepted = await vscode.window.showWarningMessage("Activez ce mode seulement si le modèle et son API acceptent les sorties JSON structurées.",
        { modal: true, detail: "En cas d'incompatibilité, la requête échouera. Vous pourrez désactiver ce mode dans les profils." }, "Activer");
      if (accepted !== "Activer") return;
    }
    await profileRepository.save({ ...profile, structuredOutput: !profile.structuredOutput });
  } else if (choice.id === "timeout") {
    const profile = activeProfile();
    const value = await vscode.window.showInputBox({ title: "Délai en secondes (5–180)", value: String(profile.timeoutSeconds), ignoreFocusOut: true });
    if (value !== undefined) await profileRepository.save({ ...profile, timeoutSeconds: Number(value) });
  } else if (choice.id === "delete") {
    const profile = activeProfile();
    const confirm = await vscode.window.showWarningMessage(`Supprimer le profil « ${profile.name} » et sa clé associée ?`, { modal: true }, "Supprimer");
    if (confirm === "Supprimer") await profileRepository.remove(profile.id);
  } else if (choice.id === "new") {
    const providers: Array<{ label: string; provider: ModelProvider; endpoint: string }> = [
      { label: "OpenAI ou compatible", provider: "openai", endpoint: "https://api.openai.com/v1" },
      { label: "Anthropic", provider: "anthropic", endpoint: "https://api.anthropic.com/v1" },
      { label: "Gemini", provider: "gemini", endpoint: "https://generativelanguage.googleapis.com/v1beta" },
      { label: "Ollama", provider: "ollama", endpoint: "http://localhost:11434" },
      { label: "Meta Muse", provider: "meta", endpoint: "https://api.meta.ai/v1" }
    ];
    const selected = await vscode.window.showQuickPick(providers, { title: "Fournisseur du nouveau profil" });
    if (!selected) return;
    const name = await vscode.window.showInputBox({ title: "Nom du profil", value: selected.label, ignoreFocusOut: true });
    if (name === undefined) return;
    const model = await vscode.window.showInputBox({ title: "Identifiant du modèle", prompt: "Saisissez un modèle disponible auprès de ce fournisseur.", ignoreFocusOut: true });
    if (model === undefined) return;
    const endpoint = selected.provider === "openai" || selected.provider === "anthropic" || selected.provider === "ollama"
      ? await vscode.window.showInputBox({ title: "URL du fournisseur", value: selected.endpoint, ignoreFocusOut: true }) : selected.endpoint;
    if (endpoint === undefined) return;
    const profile = newProfile({ name, model, provider: selected.provider, endpoint, timeoutSeconds: getConfig().timeoutSeconds });
    await profileRepository.save(profile);
    await profileRepository.importLegacyKey(profile, legacyEndpointFor(selected.provider));
    await profileRepository.select(profile.id);
  } else {
    await profileRepository.select(choice.id);
  }
  latestProviderStatus = undefined;
  checkedProfileSignature = undefined;
}

function legacyEndpointFor(provider: ModelProvider): string {
  const config = vscode.workspace.getConfiguration("explainCode");
  switch (provider) {
    case "openai": return config.get<string>("openAiBaseUrl", "https://api.openai.com/v1");
    case "anthropic": return config.get<string>("anthropicBaseUrl", "https://api.anthropic.com/v1");
    case "gemini": return "https://generativelanguage.googleapis.com/v1beta";
    case "meta": return "https://api.meta.ai/v1";
    case "ollama": return config.get<string>("ollamaUrl", "http://localhost:11434");
  }
}

async function getSourceStatus(context: CodeContext, language: UiLanguage): Promise<string | undefined> {
  if (context.startCharacter === undefined || context.endCharacter === undefined) {
    return language === "fr" ? "Version du code non vérifiable" : "Source version unavailable";
  }
  try {
    let document = vscode.workspace.textDocuments.find(item => item.fileName === context.filePath);
    if (!document) {
      const uri = vscode.Uri.file(context.filePath);
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > 1_000_000) return language === "fr" ? "Fichier trop volumineux pour comparaison" : "File too large to compare";
      document = await vscode.workspace.openTextDocument(uri);
    }
    const range = new vscode.Range(context.startLine - 1, context.startCharacter, context.endLine - 1, context.endCharacter);
    if (document.getText(range).trim() !== context.selectedCode) {
      return language === "fr" ? "Code modifié depuis l'explication" : "Code changed since this explanation";
    }
    return undefined;
  } catch {
    return language === "fr" ? "Fichier source indisponible" : "Source file unavailable";
  }
}

async function manageHistory(panel: ExplanationPanel): Promise<void> {
  const settings = vscode.workspace.getConfiguration("explainCode");
  const enabled = settings.get<boolean>("historyEnabled", false);
  const entries = historyRepository.list();
  const picked = await vscode.window.showQuickPick([
    ...entries.map(entry => ({ label: entry.context.fileName, description: `${entry.context.startLine}–${entry.context.endLine} · ${entry.model} · ${new Date(entry.updatedAt).toLocaleString()}`, id: entry.id })),
    { label: enabled ? "$(circle-slash) Désactiver l'historique" : "$(history) Activer l'historique local", description: "", id: "toggle" },
    ...(entries.length ? [{ label: "$(trash) Effacer tout l'historique", description: "", id: "clear" }] : [])
  ], { title: "Historique local XPlanator" });
  if (!picked) return;
  if (picked.id === "toggle") {
    if (!enabled) {
      const confirmed = await vscode.window.showWarningMessage(
        "L'historique enregistrera localement des copies du code, des réponses et des questions.",
        { modal: true, detail: "La détection de secrets est limitée. Activez uniquement si ce stockage vous convient." }, "Activer"
      );
      if (confirmed !== "Activer") return;
    }
    await settings.update("historyEnabled", !enabled, vscode.ConfigurationTarget.Global);
    return;
  }
  if (picked.id === "clear") {
    const confirm = await vscode.window.showWarningMessage("Effacer toutes les explications enregistrées localement ?", { modal: true }, "Effacer");
    if (confirm === "Effacer") { await historyRepository.clear(); currentHistoryId = undefined; }
    return;
  }
  const entry = entries.find(item => item.id === picked.id);
  if (!entry) return;
  const action = await vscode.window.showQuickPick([
    { label: "Ouvrir l'explication", id: "open" },
    { label: "Exporter en Markdown", id: "export" },
    { label: "Supprimer cette entrée", id: "delete" }
  ], { title: entry.context.fileName });
  if (!action) return;
  if (action.id === "delete") {
    await historyRepository.remove(entry.id);
    if (currentHistoryId === entry.id) currentHistoryId = undefined;
  } else if (action.id === "export") {
    const destination = await vscode.window.showSaveDialog({ filters: { Markdown: ["md"] }, saveLabel: "Exporter" });
    if (destination) await vscode.workspace.fs.writeFile(destination, Buffer.from(historyAsMarkdown(entry), "utf8"));
  } else {
    await restoreHistoryEntry(entry, panel);
  }
}

async function restoreHistoryEntry(entry: HistoryEntry, panel: ExplanationPanel): Promise<void> {
  activeGeneration?.abort();
  const requestId = ++generationId;
  const language = getConfig().language;
  const sourceStatus = await getSourceStatus(entry.context, language);
  if (requestId !== generationId) return;
  initialExplanation = entry.originalExplanation;
  conversation = entry.turns.map(turn => ({ ...turn }));
  currentHistoryId = entry.id;
  lastAttemptContext = entry.context;
  lastAttemptMode = entry.mode;
  lastAttemptQuestion = undefined;
  lastExplanationState = { codeContext: entry.context, explanation: conversation.at(-1)?.answer ?? initialExplanation, mode: entry.mode, sourceStatus, usageInfo: entry.usageInfo };
  panel.setQuestionDraft("");
  panel.showExplanation(lastExplanationState, language, getConfig().explanationSections);
}

function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("explainCode");
  const language = normalizeLanguage(config.get<string>("language", "fr"));
  const legacyProvider = normalizeProvider(config.get<string>("provider", "openai"));
  const state = profileRepository?.read();
  const active = state?.profiles.find(profile => profile.id === state.activeId);
  const provider = active?.provider ?? legacyProvider;

  return {
    provider,
    ollamaUrl: active?.provider === "ollama" ? active.endpoint : config.get<string>("ollamaUrl", "http://localhost:11434"),
    openAiBaseUrl: active?.provider === "openai" ? active.endpoint : config.get<string>("openAiBaseUrl", "https://api.openai.com/v1"),
    anthropicBaseUrl: active?.provider === "anthropic" ? active.endpoint : config.get<string>("anthropicBaseUrl", "https://api.anthropic.com/v1"),
    model: active?.model ?? normalizeModel(config.get<string>("model", ""), provider),
    maxSurroundingLines: config.get<number>("maxSurroundingLines", 20),
    responseStyle: config.get<ExtensionConfig["responseStyle"]>("responseStyle", "beginner"),
    responseLength: normalizeLength(config.get<string>("responseLength", "medium")),
    language,
    timeoutSeconds: active?.timeoutSeconds ?? config.get<number>("timeoutSeconds", 60),
    includeRelatedContext: config.get<boolean>("includeRelatedContext", false),
    maxRelatedSnippets: config.get<number>("maxRelatedSnippets", 0),
    maxRelatedLinesPerSnippet: config.get<number>("maxRelatedLinesPerSnippet", 28),
    maxContextCharacters: config.get<number>("maxContextCharacters", 8000),
    explanationSections: normalizeExplanationSections(config.get<string[]>("explanationSections", ["summary", "details", "takeaway"]))
  };
}

function normalizeProvider(value: string): ModelProvider {
  switch (value) {
    case "openai":
    case "meta":
    case "gemini":
    case "anthropic":
    case "ollama":
      return value;
    default:
      return "openai";
  }
}

function normalizeModel(value: string | undefined, _provider: ModelProvider): string {
  return value?.trim() ?? "";
}

function buildConfigFromSettings(settings: ModelSettingsInput | undefined): ExtensionConfig {
  const config = getConfig();
  const provider = normalizeProvider(settings?.provider ?? config.provider);

  return {
    ...config,
    provider,
    model: normalizeModel(settings?.model, provider),
    ollamaUrl: settings?.ollamaUrl?.trim() || config.ollamaUrl,
    openAiBaseUrl: settings?.openAiBaseUrl?.trim() || config.openAiBaseUrl,
    anthropicBaseUrl: settings?.anthropicBaseUrl?.trim() || config.anthropicBaseUrl,
    explanationSections: normalizeExplanationSections(settings?.explanationSections ?? config.explanationSections)
  };
}

function normalizeExplanationSections(values: readonly string[] | undefined): ExplanationSection[] {
  const allowed: ExplanationSection[] = ["summary", "details", "takeaway"];
  const selected = allowed.filter((section) => values?.includes(section));
  return selected.length ? selected : ["summary"];
}

function normalizeLength(value: string): ExtensionConfig["responseLength"] {
  return value === "short" || value === "long" ? value : "medium";
}

function handleError(error: unknown): void {
  const message = error instanceof Error ? error.message : localize(getConfig().language, "unknownError");
  vscode.window.showErrorMessage(message);
}

function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 110);
  item.name = "XPlanator";
  item.command = "explainCode.explainAtCursor";
  return item;
}

function updateStatusBarItem(item: vscode.StatusBarItem): void {
  const editor = vscode.window.activeTextEditor;
  const language = getConfig().language;

  if (!editor || editor.document.uri.scheme !== "file") {
    item.hide();
    return;
  }

  const hasSelection = !editor.selection.isEmpty;
  item.text = hasSelection
    ? `$(lightbulb) ${localize(language, "statusExplainSelection")}`
    : `$(lightbulb) ${localize(language, "statusExplainHere")}`;
  item.tooltip = hasSelection
    ? localize(language, "statusTooltipSelection")
    : localize(language, "statusTooltipCursor");
  item.command = hasSelection ? "explainCode.explainSelection" : "explainCode.explainAtCursor";
  item.show();
}

function normalizeLanguage(value: string): UiLanguage {
  return value.toLowerCase().startsWith("en") ? "en" : "fr";
}

function hasEndpointChanged(previousValue: string, nextValue: string): boolean {
  const previous = normalizeEndpointForComparison(previousValue);
  const next = normalizeEndpointForComparison(nextValue);
  return previous !== next;
}

function normalizeEndpointForComparison(value: string): string {
  const normalized = value.trim();

  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    const query = parsed.search;
    return `${parsed.protocol}//${parsed.host}${path}${query}`;
  } catch {
    return normalized;
  }
}

function validateEndpointUrl(language: UiLanguage, endpointUrl: string, endpointLabel: string): void {
  let parsed: URL;

  try {
    parsed = new URL(endpointUrl);
  } catch {
    throw new Error(localize(language, "endpointInvalidUrl", endpointLabel));
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(localize(language, "endpointInvalidProtocol", endpointLabel));
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0";

  if (!isLocalHost && parsed.protocol !== "https:") {
    throw new Error(localize(language, "endpointHttpsRequired", endpointLabel));
  }
}

async function confirmEndpointSettingsChange(language: UiLanguage, endpointChanges: string[]): Promise<boolean> {
  const endpoints = endpointChanges.join(", ");
  const confirmLabel = localize(language, "confirmEndpointChanges");
  const selected = await vscode.window.showWarningMessage(
    localize(language, "endpointChangeWarning", endpoints),
    {
      modal: true,
      detail: localize(language, "endpointChangeWarningDetail")
    },
    confirmLabel
  );

  return selected === confirmLabel;
}

function localize(language: UiLanguage, key: string, modelName?: string): string {
  const fr: Record<string, string> = {
    noExplanationToCopy: "Aucune explication a copier pour le moment.",
    sectionCopied: "Section copiee.",
    nothingToRetry: "Aucune explication precedente a relancer.",
    openFileAndSelectCode: "Ouvrez un fichier puis selectionnez du code a expliquer.",
    openFileForCursorExplain: "Ouvrez un fichier pour expliquer la ligne ou le symbole sous le curseur.",
    nothingToSimplify: "Aucune explication precedente a simplifier.",
    nothingToDetail: "Aucune explication precedente a detailler.",
    firstRunSetupPrompt: "XPlanator est pret. Ouvrez les parametres pour choisir OpenAI/Codex, Claude, Gemini ou Ollama.",
    firstRunOpenSettings: "Ouvrir les parametres",
    firstRunLater: "Plus tard",
    providerConnected: "Catalogue accessible. La génération et le modèle sélectionné ne sont pas vérifiés.",
    ollamaModelMissing: `Ollama est connecte, mais le modele configure semble absent. Essayez : ollama pull ${modelName ?? "qwen2.5-coder"}`,
    providerNotRunning: "Le fournisseur IA ne repond pas. Verifiez Ollama, la connexion, le modele ou la cle API.",
    loadingWithProvider: "Le code est en cours d'analyse avec le fournisseur IA...",
    settingsSaved: "Parametres enregistres.",
    settingsChangeCanceled: "Modification des parametres annulee.",
    progressTitle: "Explain Code",
    unknownError: "Une erreur inconnue est survenue.",
    missingProviderKeyDetails: "Aucune cle API n'est enregistree pour {modelName}. Ouvrez les parametres, ajoutez une cle, puis reessayez, ou repassez sur Ollama.",
    providerStatusNotChecked: "Connexion non verifiee.",
    providerStatusConnected: "Catalogue accessible. La génération et le modèle sélectionné ne sont pas vérifiés.",
    providerStatusConnectedWithModel: "Catalogue accessible. Modèle détecté : {modelName}. Génération non vérifiée.",
    providerStatusFailed: "Echec de la verification de connexion.",
    statusExplainSelection: "Expliquer la selection",
    statusExplainHere: "Expliquer ici",
    statusTooltipSelection: "XPlanator : expliquer le code selectionne",
    statusTooltipCursor: "XPlanator : expliquer la ligne ou le symbole sous le curseur",
    ollamaEndpointLabel: "URL Ollama",
    openAiEndpointLabel: "URL OpenAI",
    anthropicEndpointLabel: "URL Anthropic",
    endpointInvalidUrl: "{modelName} est invalide. Entrez une URL complete (http://... ou https://...).",
    endpointInvalidProtocol: "{modelName} doit utiliser http:// ou https://.",
    endpointHttpsRequired: "{modelName} doit utiliser HTTPS pour les hotes non locaux.",
    endpointChangeWarning: "Vous allez modifier {modelName}. Continuez-vous ?",
    endpointChangeWarningDetail: "Les changements d'URL peuvent rediriger vos requetes et credentials vers un autre endpoint.",
    confirmEndpointChanges: "Oui, enregistrer"
  };

  const en: Record<string, string> = {
    noExplanationToCopy: "There is no explanation to copy yet.",
    sectionCopied: "Section copied.",
    nothingToRetry: "There is no previous explanation to retry.",
    openFileAndSelectCode: "Open a file and select code to explain.",
    openFileForCursorExplain: "Open a file to explain the current line or symbol under the cursor.",
    nothingToSimplify: "There is no previous explanation to simplify.",
    nothingToDetail: "There is no previous explanation to expand.",
    firstRunSetupPrompt: "XPlanator is ready. Open settings to choose OpenAI/Codex, Claude, Gemini, or Ollama.",
    firstRunOpenSettings: "Open settings",
    firstRunLater: "Later",
    providerConnected: "Catalog accessible. Generation and the selected model have not been verified.",
    ollamaModelMissing: `Ollama is connected, but the configured model seems missing. Try: ollama pull ${modelName ?? "qwen2.5-coder"}`,
    providerNotRunning: "The AI provider is not responding. Check Ollama, the connection, the model, or the API key.",
    loadingWithProvider: "Analyzing code with the AI provider...",
    settingsSaved: "Settings saved.",
    settingsChangeCanceled: "Settings update canceled.",
    progressTitle: "Explain Code",
    unknownError: "An unknown error occurred.",
    missingProviderKeyDetails: "No API key is saved for {modelName}. Open Settings, add a key, then retry, or switch back to Ollama.",
    providerStatusNotChecked: "Connection not checked yet.",
    providerStatusConnected: "Catalog accessible. Generation and the selected model have not been verified.",
    providerStatusConnectedWithModel: "Catalog accessible. Detected model: {modelName}. Generation not verified.",
    providerStatusFailed: "Connection check failed.",
    statusExplainSelection: "Explain selection",
    statusExplainHere: "Explain here",
    statusTooltipSelection: "XPlanator: explain the selected code",
    statusTooltipCursor: "XPlanator: explain the current line or symbol under the cursor",
    ollamaEndpointLabel: "Ollama URL",
    openAiEndpointLabel: "OpenAI URL",
    anthropicEndpointLabel: "Anthropic URL",
    endpointInvalidUrl: "{modelName} is invalid. Enter a full URL (http://... or https://...).",
    endpointInvalidProtocol: "{modelName} must use http:// or https://.",
    endpointHttpsRequired: "{modelName} must use HTTPS for non-local hosts.",
    endpointChangeWarning: "You are about to change {modelName}. Continue?",
    endpointChangeWarningDetail: "Changing endpoint URLs can redirect requests and credentials to a different destination.",
    confirmEndpointChanges: "Yes, save"
  };

  const text = (language === "en" ? en : fr)[key] ?? key;

  if (!modelName) {
    return text;
  }

  return text.replace("{modelName}", modelName);
}
