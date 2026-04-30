import * as vscode from "vscode";
import { AiClient } from "./aiClient";
import { getCodeContext } from "./contextExtractor";
import { buildPrompt } from "./promptBuilder";
import {
  CodeContext,
  ExplanationMode,
  ExtensionConfig,
  LastExplanationState,
  ModelProvider,
  ModelSettingsInput,
  UiLanguage
} from "./types";
import { ExplanationPanel, PanelMessage } from "./webviewPanel";

type CopySection = "summary" | "details" | "takeaway";

let lastExplanationState: LastExplanationState | undefined;
let lastAttemptContext: CodeContext | undefined;
let lastAttemptMode: ExplanationMode = "quick";

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

    if (action === "cancelSettings") {
      if (lastExplanationState) {
        panel.showExplanation(
          {
            codeContext: lastExplanationState.codeContext,
            explanation: lastExplanationState.explanation
          },
          getConfig().language
        );
        return;
      }

      panel.showEmptyState(getConfig().language);
      return;
    }

    if (action === "saveSettings") {
      await saveSettings(message.settings, aiClient);
      await showSettings(panel, aiClient);
    }
  });

  const statusBarItem = createStatusBarItem();

  context.subscriptions.push(
    statusBarItem,
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
}

export function deactivate(): void {}

async function explainFromContext(
  codeContext: CodeContext,
  mode: ExplanationMode,
  panel: ExplanationPanel,
  aiClient: AiClient
): Promise<void> {
  const config = getConfig();
  const prompt = buildPrompt(
    {
      context: codeContext,
      responseLanguage: config.language,
      responseStyle: config.responseStyle
    },
    mode
  );

  lastAttemptContext = codeContext;
  lastAttemptMode = mode;
  panel.showLoading(localize(config.language, "loadingWithProvider"), config.language);

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
          maxTokens: mode === "detailed" ? 450 : 250
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
      config.language
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : localize(config.language, "unknownError");
    panel.showError(message, config.language, codeContext);
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
      hasApiKey: await aiClient.hasApiKey(config.provider)
    },
    config.language
  );
}

async function saveSettings(settings: ModelSettingsInput | undefined, aiClient: AiClient): Promise<void> {
  const config = vscode.workspace.getConfiguration("explainCode");
  const provider = normalizeProvider(settings?.provider ?? "ollama");
  const model = normalizeModel(settings?.model, provider);
  const ollamaUrl = settings?.ollamaUrl?.trim() || "http://localhost:11434";
  const openAiBaseUrl = settings?.openAiBaseUrl?.trim() || "https://api.openai.com/v1";

  await config.update("provider", provider, vscode.ConfigurationTarget.Global);
  await config.update("model", model, vscode.ConfigurationTarget.Global);
  await config.update("ollamaUrl", ollamaUrl, vscode.ConfigurationTarget.Global);
  await config.update("openAiBaseUrl", openAiBaseUrl, vscode.ConfigurationTarget.Global);
  await aiClient.saveApiKey(provider, settings?.apiKey, settings?.clearApiKey);

  vscode.window.showInformationMessage(localize(getConfig().language, "settingsSaved"));
}

function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration("explainCode");
  const language = normalizeLanguage(config.get<string>("language", "fr"));
  const provider = normalizeProvider(config.get<string>("provider", "ollama"));

  return {
    provider,
    ollamaUrl: config.get<string>("ollamaUrl", "http://localhost:11434"),
    openAiBaseUrl: config.get<string>("openAiBaseUrl", "https://api.openai.com/v1"),
    model: normalizeModel(config.get<string>("model", ""), provider),
    maxSurroundingLines: config.get<number>("maxSurroundingLines", 60),
    responseStyle: config.get<ExtensionConfig["responseStyle"]>("responseStyle", "beginner"),
    language,
    timeoutSeconds: config.get<number>("timeoutSeconds", 30),
    includeRelatedContext: config.get<boolean>("includeRelatedContext", true),
    maxRelatedSnippets: config.get<number>("maxRelatedSnippets", 3),
    maxRelatedLinesPerSnippet: config.get<number>("maxRelatedLinesPerSnippet", 28),
    maxContextCharacters: config.get<number>("maxContextCharacters", 24000)
  };
}

function normalizeProvider(value: string): ModelProvider {
  switch (value) {
    case "openai":
    case "gemini":
    case "anthropic":
    case "ollama":
      return value;
    default:
      return "ollama";
  }
}

function normalizeModel(value: string | undefined, provider: ModelProvider): string {
  const normalized = value?.trim();

  if (normalized) {
    return normalized;
  }

  switch (provider) {
    case "openai":
      return "gpt-5";
    case "gemini":
      return "gemini-2.5-flash";
    case "anthropic":
      return "claude-sonnet-4-5";
    case "ollama":
    default:
      return "qwen2.5-coder";
  }
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

function localize(language: UiLanguage, key: string, modelName?: string): string {
  const fr: Record<string, string> = {
    noExplanationToCopy: "Aucune explication a copier pour le moment.",
    sectionCopied: "Section copiee.",
    nothingToRetry: "Aucune explication precedente a relancer.",
    openFileAndSelectCode: "Ouvrez un fichier puis selectionnez du code a expliquer.",
    openFileForCursorExplain: "Ouvrez un fichier pour expliquer la ligne ou le symbole sous le curseur.",
    nothingToSimplify: "Aucune explication precedente a simplifier.",
    nothingToDetail: "Aucune explication precedente a detailler.",
    providerConnected: "Le fournisseur IA est connecte.",
    ollamaModelMissing: `Ollama est connecte, mais le modele configure semble absent. Essayez : ollama pull ${modelName ?? "qwen2.5-coder"}`,
    providerNotRunning: "Le fournisseur IA ne repond pas. Verifiez Ollama, la connexion, le modele ou la cle API.",
    loadingWithProvider: "Le code est en cours d'analyse avec le fournisseur IA...",
    settingsSaved: "Parametres enregistres.",
    progressTitle: "Explain Code",
    unknownError: "Une erreur inconnue est survenue.",
    statusExplainSelection: "Expliquer la selection",
    statusExplainHere: "Expliquer ici",
    statusTooltipSelection: "XPlanator : expliquer le code selectionne",
    statusTooltipCursor: "XPlanator : expliquer la ligne ou le symbole sous le curseur"
  };

  const en: Record<string, string> = {
    noExplanationToCopy: "There is no explanation to copy yet.",
    sectionCopied: "Section copied.",
    nothingToRetry: "There is no previous explanation to retry.",
    openFileAndSelectCode: "Open a file and select code to explain.",
    openFileForCursorExplain: "Open a file to explain the current line or symbol under the cursor.",
    nothingToSimplify: "There is no previous explanation to simplify.",
    nothingToDetail: "There is no previous explanation to expand.",
    providerConnected: "The AI provider is connected.",
    ollamaModelMissing: `Ollama is connected, but the configured model seems missing. Try: ollama pull ${modelName ?? "qwen2.5-coder"}`,
    providerNotRunning: "The AI provider is not responding. Check Ollama, the connection, the model, or the API key.",
    loadingWithProvider: "Analyzing code with the AI provider...",
    settingsSaved: "Settings saved.",
    progressTitle: "Explain Code",
    unknownError: "An unknown error occurred.",
    statusExplainSelection: "Explain selection",
    statusExplainHere: "Explain here",
    statusTooltipSelection: "XPlanator: explain the selected code",
    statusTooltipCursor: "XPlanator: explain the current line or symbol under the cursor"
  };

  return (language === "en" ? en : fr)[key] ?? key;
}
