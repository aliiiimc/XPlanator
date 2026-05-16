import * as vscode from "vscode";
import { AiClient } from "./aiClient";
import { getCodeContext } from "./contextExtractor";
import { buildPrompt } from "./promptBuilder";
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

const quickExplanationMaxTokens = 2048;
const detailedExplanationMaxTokens = 4096;

export function activate(context: vscode.ExtensionContext): void {
  const aiClient = new AiClient(context.secrets);
  const panel = new ExplanationPanel(context.extensionUri, async (message: PanelMessage) => {
    const action = message.action;

    if (!action) {
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

    if (action === "retry") {
      if (!lastAttemptContext) {
        vscode.window.showInformationMessage(localize(getConfig().language, "nothingToRetry"));
        return;
      }

      await explainFromContext(lastAttemptContext, lastAttemptMode, panel, aiClient);
      return;
    }

    if (action === "settings") {
      await showSettings(panel, aiClient);
      return;
    }

    if (action === "setExplanationSections") {
      await updateExplanationSections(message.explanationSections);
      return;
    }

    if (action === "checkSettingsConnection") {
      await checkSettingsConnection(panel, aiClient, message.settings);
      return;
    }

    if (action === "cancelSettings") {
      if (lastExplanationState) {
        panel.showExplanation(
          {
            codeContext: lastExplanationState.codeContext,
            explanation: lastExplanationState.explanation
          },
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
        await showSettings(panel, aiClient);
      }
    }
  });

  const statusBarItem = createStatusBarItem();

  context.subscriptions.push(
    statusBarItem,
    vscode.commands.registerCommand("explainCode.openPanel", async () => {
      panel.showEmptyState(getConfig().language, getConfig().explanationSections);
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

    vscode.commands.registerCommand("explainCode.explainMoreSimply", async () => {
      if (!lastExplanationState) {
        vscode.window.showInformationMessage(localize(getConfig().language, "nothingToSimplify"));
        return;
      }

      await explainFromContext(lastExplanationState.codeContext, "simple", panel, aiClient);
    }),

    vscode.commands.registerCommand("explainCode.explainInMoreDetail", async () => {
      if (!lastExplanationState) {
        vscode.window.showInformationMessage(localize(getConfig().language, "nothingToDetail"));
        return;
      }

      await explainFromContext(lastExplanationState.codeContext, "detailed", panel, aiClient);
    }),

    vscode.commands.registerCommand("explainCode.openSettings", async () => {
      await showSettings(panel, aiClient);
    }),

    vscode.commands.registerCommand("explainCode.checkOllama", async () => {
      const config = getConfig();

      try {
        const status = await aiClient.checkConnection(config);
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
    vscode.window.onDidChangeTextEditorSelection(() => updateStatusBarItem(statusBarItem))
  );

  updateStatusBarItem(statusBarItem);
  void maybeShowFirstRunSetup(context, panel, aiClient);
}

export function deactivate(): void {}

async function explainFromContext(
  codeContext: CodeContext,
  mode: ExplanationMode,
  panel: ExplanationPanel,
  aiClient: AiClient
): Promise<void> {
  const config = getConfig();

  if (config.provider !== "ollama" && !(await aiClient.hasApiKey(config.provider))) {
    const message = localize(config.language, "missingProviderKeyDetails", getProviderLabel(config.provider));
    panel.showError(message, config.language, codeContext, config.explanationSections);
    vscode.window.showErrorMessage(message);
    return;
  }

  const prompt = buildPrompt(
    {
      context: codeContext,
      responseLanguage: config.language,
      responseStyle: config.responseStyle,
      explanationSections: config.explanationSections
    },
    mode
  );

  lastAttemptContext = codeContext;
  lastAttemptMode = mode;
  panel.showLoading(localize(config.language, "loadingWithProvider"), config.language, config.explanationSections);

  try {
    const explanation = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: localize(config.language, "progressTitle"),
        cancellable: false
      },
      async () =>
        aiClient.generate(config, {
          prompt,
          maxTokens: mode === "detailed" ? detailedExplanationMaxTokens : quickExplanationMaxTokens
        })
    );

    lastExplanationState = {
      codeContext,
      explanation,
      mode
    };

    panel.showExplanation(
      {
        codeContext,
        explanation
      },
      config.language,
      config.explanationSections
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : localize(config.language, "unknownError");
    panel.showError(message, config.language, codeContext, config.explanationSections);
    vscode.window.showErrorMessage(message);
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
      hasApiKey: await aiClient.hasApiKey(config.provider),
      apiKey: "",
      clearApiKey: false,
      providerStatus: latestProviderStatus ?? {
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
  settings: ModelSettingsInput | undefined
): Promise<void> {
  const previewConfig = buildConfigFromSettings(settings);
  const apiKeyOverride = settings?.apiKey?.trim() || undefined;

  try {
    validateEndpointUrl(previewConfig.language, previewConfig.ollamaUrl, localize(previewConfig.language, "ollamaEndpointLabel"));
    validateEndpointUrl(previewConfig.language, previewConfig.openAiBaseUrl, localize(previewConfig.language, "openAiEndpointLabel"));
    validateEndpointUrl(previewConfig.language, previewConfig.anthropicBaseUrl, localize(previewConfig.language, "anthropicEndpointLabel"));

    if (previewConfig.provider !== "ollama" && !apiKeyOverride && !(await aiClient.hasApiKey(previewConfig.provider))) {
      latestProviderStatus = {
        kind: "error",
        message: localize(previewConfig.language, "missingProviderKeyDetails", getProviderLabel(previewConfig.provider))
      };
    } else {
      const status = await aiClient.checkConnection(previewConfig, apiKeyOverride);
      const successMessage =
        previewConfig.provider === "ollama" && status.models.length > 0
          ? localize(previewConfig.language, "providerStatusConnectedWithModel", status.models[0])
          : localize(previewConfig.language, "providerStatusConnected");

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

  await showSettingsDraft(panel, aiClient, settings, previewConfig.language);
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
      hasApiKey: await aiClient.hasApiKey(previewConfig.provider),
      apiKey: settings?.apiKey ?? "",
      clearApiKey: settings?.clearApiKey ?? false,
      providerStatus: latestProviderStatus ?? {
        kind: "idle",
        message: localize(language, "providerStatusNotChecked")
      }
    },
    language
  );
}

async function saveSettings(settings: ModelSettingsInput | undefined, aiClient: AiClient): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("explainCode");
  const language = getConfig().language;
  const provider = normalizeProvider(settings?.provider ?? "openai");
  const model = normalizeModel(settings?.model, provider);
  const ollamaUrl = settings?.ollamaUrl?.trim() || "http://localhost:11434";
  const openAiBaseUrl = settings?.openAiBaseUrl?.trim() || "https://api.openai.com/v1";
  const anthropicBaseUrl = settings?.anthropicBaseUrl?.trim() || "https://api.anthropic.com/v1";
  const explanationSections = normalizeExplanationSections(
    settings?.explanationSections ?? config.get<string[]>("explanationSections", ["summary", "details", "takeaway"])
  );

  validateEndpointUrl(language, ollamaUrl, localize(language, "ollamaEndpointLabel"));
  validateEndpointUrl(language, openAiBaseUrl, localize(language, "openAiEndpointLabel"));
  validateEndpointUrl(language, anthropicBaseUrl, localize(language, "anthropicEndpointLabel"));

  const currentOllamaUrl = config.get<string>("ollamaUrl", "http://localhost:11434");
  const currentOpenAiBaseUrl = config.get<string>("openAiBaseUrl", "https://api.openai.com/v1");
  const currentAnthropicBaseUrl = config.get<string>("anthropicBaseUrl", "https://api.anthropic.com/v1");
  const endpointChanges: string[] = [];

  if (hasEndpointChanged(currentOllamaUrl, ollamaUrl)) {
    endpointChanges.push(localize(language, "ollamaEndpointLabel"));
  }

  if (hasEndpointChanged(currentOpenAiBaseUrl, openAiBaseUrl)) {
    endpointChanges.push(localize(language, "openAiEndpointLabel"));
  }

  if (hasEndpointChanged(currentAnthropicBaseUrl, anthropicBaseUrl)) {
    endpointChanges.push(localize(language, "anthropicEndpointLabel"));
  }

  if (endpointChanges.length > 0) {
    const confirmed = await confirmEndpointSettingsChange(language, endpointChanges);

    if (!confirmed) {
      vscode.window.showInformationMessage(localize(language, "settingsChangeCanceled"));
      return false;
    }
  }

  await config.update("provider", provider, vscode.ConfigurationTarget.Global);
  await config.update("model", model, vscode.ConfigurationTarget.Global);
  await config.update("ollamaUrl", ollamaUrl, vscode.ConfigurationTarget.Global);
  await config.update("openAiBaseUrl", openAiBaseUrl, vscode.ConfigurationTarget.Global);
  await config.update("anthropicBaseUrl", anthropicBaseUrl, vscode.ConfigurationTarget.Global);
  await config.update("explanationSections", explanationSections, vscode.ConfigurationTarget.Global);
  await aiClient.saveApiKey(provider, settings?.apiKey, settings?.clearApiKey);
  latestProviderStatus = {
    kind: "idle",
    message: localize(language, "providerStatusNotChecked")
  };

  vscode.window.showInformationMessage(localize(language, "settingsSaved"));
  return true;
}

async function updateExplanationSections(sections: readonly string[] | undefined): Promise<void> {
  await vscode.workspace
    .getConfiguration("explainCode")
    .update("explanationSections", normalizeExplanationSections(sections), vscode.ConfigurationTarget.Global);
}

function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("explainCode");
  const language = normalizeLanguage(config.get<string>("language", "fr"));
  const provider = normalizeProvider(config.get<string>("provider", "openai"));

  return tuneConfigForProvider({
    provider,
    ollamaUrl: config.get<string>("ollamaUrl", "http://localhost:11434"),
    openAiBaseUrl: config.get<string>("openAiBaseUrl", "https://api.openai.com/v1"),
    anthropicBaseUrl: config.get<string>("anthropicBaseUrl", "https://api.anthropic.com/v1"),
    model: normalizeModel(config.get<string>("model", ""), provider),
    maxSurroundingLines: config.get<number>("maxSurroundingLines", 20),
    responseStyle: config.get<ExtensionConfig["responseStyle"]>("responseStyle", "beginner"),
    language,
    timeoutSeconds: config.get<number>("timeoutSeconds", 60),
    includeRelatedContext: config.get<boolean>("includeRelatedContext", false),
    maxRelatedSnippets: config.get<number>("maxRelatedSnippets", 0),
    maxRelatedLinesPerSnippet: config.get<number>("maxRelatedLinesPerSnippet", 28),
    maxContextCharacters: config.get<number>("maxContextCharacters", 8000),
    explanationSections: normalizeExplanationSections(config.get<string[]>("explanationSections", ["summary", "details", "takeaway"]))
  });
}

function normalizeProvider(value: string): ModelProvider {
  switch (value) {
    case "openai":
    case "gemini":
    case "anthropic":
    case "ollama":
      return value;
    default:
      return "openai";
  }
}

function normalizeModel(value: string | undefined, provider: ModelProvider): string {
  const normalized = normalizeProviderModelName(value?.trim(), provider);

  if (normalized && normalized !== "free-lite") {
    return normalized;
  }

  switch (provider) {
    case "openai":
      return "gpt-5-nano";
    case "gemini":
      return "gemini-2.5-flash";
    case "anthropic":
      return "claude-sonnet-4-5";
    case "ollama":
    default:
      return "qwen2.5-coder";
  }
}

function normalizeProviderModelName(value: string | undefined, provider: ModelProvider): string | undefined {
  if (!value) {
    return undefined;
  }

  if (provider !== "openai") {
    return value;
  }

  const compact = value.toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  const openAiAliases: Record<string, string> = {
    gpt5nano: "gpt-5-nano",
    "gpt-5-nano": "gpt-5-nano",
    "chatgpt-5-nano": "gpt-5-nano",
    gpt5mini: "gpt-5-mini",
    "gpt-5-mini": "gpt-5-mini",
    "chatgpt-5-mini": "gpt-5-mini",
    gpt54nano: "gpt-5.4-nano",
    "gpt-5.4-nano": "gpt-5.4-nano",
    "chatgpt-5.4-nano": "gpt-5.4-nano",
    gpt54mini: "gpt-5.4-mini",
    "gpt-5.4-mini": "gpt-5.4-mini",
    "chatgpt-5.4-mini": "gpt-5.4-mini",
    "gpt-4o-mini": "gpt-4o-mini",
    "gpt-4.1-mini": "gpt-4.1-mini"
  };

  return openAiAliases[compact] ?? value;
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

function tuneConfigForProvider(config: ExtensionConfig): ExtensionConfig {
  if (config.provider !== "ollama") {
    return config;
  }

  return {
    ...config,
    maxSurroundingLines: Math.min(config.maxSurroundingLines, 20),
    includeRelatedContext: false,
    maxRelatedSnippets: 0,
    maxContextCharacters: Math.min(config.maxContextCharacters, 8000)
  };
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
    providerConnected: "Le fournisseur IA est connecte.",
    ollamaModelMissing: `Ollama est connecte, mais le modele configure semble absent. Essayez : ollama pull ${modelName ?? "qwen2.5-coder"}`,
    providerNotRunning: "Le fournisseur IA ne repond pas. Verifiez Ollama, la connexion, le modele ou la cle API.",
    loadingWithProvider: "Le code est en cours d'analyse avec le fournisseur IA...",
    settingsSaved: "Parametres enregistres.",
    settingsChangeCanceled: "Modification des parametres annulee.",
    progressTitle: "Explain Code",
    unknownError: "Une erreur inconnue est survenue.",
    missingProviderKeyDetails: "Aucune cle API n'est enregistree pour {modelName}. Ouvrez les parametres, ajoutez une cle, puis reessayez, ou repassez sur Ollama.",
    providerStatusNotChecked: "Connexion non verifiee.",
    providerStatusConnected: "Connexion reussie.",
    providerStatusConnectedWithModel: "Connexion reussie. Modele detecte : {modelName}.",
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
    providerConnected: "The AI provider is connected.",
    ollamaModelMissing: `Ollama is connected, but the configured model seems missing. Try: ollama pull ${modelName ?? "qwen2.5-coder"}`,
    providerNotRunning: "The AI provider is not responding. Check Ollama, the connection, the model, or the API key.",
    loadingWithProvider: "Analyzing code with the AI provider...",
    settingsSaved: "Settings saved.",
    settingsChangeCanceled: "Settings update canceled.",
    progressTitle: "Explain Code",
    unknownError: "An unknown error occurred.",
    missingProviderKeyDetails: "No API key is saved for {modelName}. Open Settings, add a key, then retry, or switch back to Ollama.",
    providerStatusNotChecked: "Connection not checked yet.",
    providerStatusConnected: "Connection successful.",
    providerStatusConnectedWithModel: "Connection successful. Detected model: {modelName}.",
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
