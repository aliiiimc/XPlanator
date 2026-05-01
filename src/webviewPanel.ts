import * as vscode from "vscode";
import { ExplanationSections, parseExplanation, stripHighlightMarkers } from "./explanationParser";
import { CodeContext, ModelSettingsInput, ProviderConnectionStatus, UiLanguage } from "./types";

type SectionKey = "summary" | "details" | "takeaway";
type PanelAction =
  | "moreSimple"
  | "moreDetailed"
  | "retry"
  | "settings"
  | "saveSettings"
  | "cancelSettings"
  | "checkSettingsConnection"
  | `copy:${SectionKey}`;

export interface PanelMessage {
  action?: PanelAction;
  settings?: ModelSettingsInput;
}

interface PanelState {
  codeContext: CodeContext;
  explanation: string;
}

interface SettingsViewModel extends ModelSettingsInput {
  hasApiKey: boolean;
  providerStatus: ProviderConnectionStatus;
}

export class ExplanationPanel {
  private panel: vscode.WebviewPanel | undefined;
  private latestState: PanelState | undefined;
  private latestSections: ExplanationSections | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onAction: (message: PanelMessage) => void
  ) {}

  showEmptyState(language: UiLanguage): void {
    const panel = this.ensurePanel();
    const text = getUiText(language);
    const sections: ExplanationSections = {
      summary: text.emptySummary,
      details: text.emptyDetails,
      takeaway: text.emptyTakeaway
    };
    this.latestSections = sections;
    panel.title = text.appName;
    panel.webview.html = this.renderHtml({
      language,
      title: text.appName,
      subtitle: text.ready,
      metadata: [],
      sections,
      isError: false,
      loading: false
    });
  }

  showLoading(message: string, language: UiLanguage): void {
    const panel = this.ensurePanel();
    const text = getUiText(language);
    const sections: ExplanationSections = {
      summary: text.loadingSummary,
      details: message,
      takeaway: text.loadingTakeaway
    };
    this.latestSections = sections;
    panel.title = text.appName;
    panel.webview.html = this.renderHtml({
      language,
      title: text.appName,
      subtitle: text.analyzing,
      metadata: [],
      sections,
      isError: false,
      loading: true
    });
    panel.reveal(vscode.ViewColumn.Beside, true);
  }

  showExplanation(state: PanelState, language: UiLanguage): void {
    this.latestState = state;
    const panel = this.ensurePanel();
    const text = getUiText(language);
    const sections = parseExplanation(state.explanation, language);
    this.latestSections = sections;
    panel.title = text.appName;
    panel.webview.html = this.renderHtml({
      language,
      title: text.appName,
      subtitle: "",
      metadata: buildMetadata(state.codeContext, language),
      sections,
      isError: false,
      loading: false
    });
    panel.reveal(vscode.ViewColumn.Beside, true);
  }

  showError(message: string, language: UiLanguage, codeContext?: CodeContext): void {
    const panel = this.ensurePanel();
    const text = getUiText(language);
    const sections: ExplanationSections = {
      summary: text.errorSummary,
      details: message,
      takeaway: text.errorTakeaway
    };
    this.latestSections = sections;
    panel.title = text.appName;
    panel.webview.html = this.renderHtml({
      language,
      title: text.appName,
      subtitle: text.error,
      metadata: codeContext ? buildMetadata(codeContext, language) : [],
      sections,
      isError: true,
      loading: false
    });
    panel.reveal(vscode.ViewColumn.Beside, true);
  }

  showSettings(settings: SettingsViewModel, language: UiLanguage): void {
    const panel = this.ensurePanel();
    const text = getUiText(language);

    panel.title = text.settings;
    panel.webview.html = this.renderHtml({
      language,
      title: text.appName,
      subtitle: text.settings,
      metadata: [],
      sections: this.latestSections ?? {
        summary: text.emptySummary,
        details: text.emptyDetails,
        takeaway: text.emptyTakeaway
      },
      isError: false,
      loading: false,
      settings
    });
    panel.reveal(vscode.ViewColumn.Beside, true);
  }

  getLatestExplanationText(): string | undefined {
    return this.latestState ? stripHighlightMarkers(this.latestState.explanation) : undefined;
  }

  getLatestSectionText(section: SectionKey): string | undefined {
    const value = this.latestSections?.[section];
    return value ? stripHighlightMarkers(value) : undefined;
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel) {
      return this.panel;
    }

    this.panel = vscode.window.createWebviewPanel(
      "xplanator.explanation",
      "XPlanator",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri]
      }
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.onDidReceiveMessage((message: PanelMessage) => {
      if (!message.action) {
        return;
      }

      this.onAction(message);
    });

    return this.panel;
  }

  private renderHtml(input: {
    language: UiLanguage;
    title: string;
    subtitle: string;
    metadata: string[];
    sections: ExplanationSections;
    isError: boolean;
    loading: boolean;
    settings?: SettingsViewModel;
  }): string {
    const nonce = getNonce();
    const text = getUiText(input.language);
    const subtitle = input.subtitle
      ? `<div class="subtitle">${escapeHtml(input.subtitle)}</div>`
      : "";
    const metadata = input.metadata.length
      ? `<div class="metaRow">${input.metadata
          .map((item) => `<span class="metaChip">${escapeHtml(item)}</span>`)
          .join("")}</div>`
      : "";

    const bodyContent = input.settings
      ? renderSettingsView(input.settings, text)
      : `${metadata}
      <div class="sections">
        ${renderSectionCard("summary", text.generalIdea, input.sections.summary, input.isError, input.loading, true)}
        ${renderSectionCard("details", text.details, input.sections.details, input.isError, input.loading, false)}
        ${renderSectionCard("takeaway", text.takeaway, input.sections.takeaway, input.isError, input.loading, false)}
      </div>
      <div class="hint">${escapeHtml(text.hint)}</div>`;

    return `<!DOCTYPE html>
<html lang="${input.language}">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(input.title)}</title>
    <style>
      :root {
        color-scheme: light dark;
      }

      body {
        margin: 0;
        padding: 16px;
        color: var(--vscode-editor-foreground);
        background: var(--vscode-editor-background);
        font-family: var(--vscode-font-family);
        font-size: 13px;
      }

      .layout {
        display: grid;
        gap: 10px;
        max-width: 840px;
        margin: 0 auto;
      }

      .hero {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        padding: 10px 12px;
        background: var(--vscode-editorWidget-background);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }

      .title {
        font-family: var(--vscode-font-family);
        font-size: 15px;
        font-weight: 800;
        letter-spacing: -0.01em;
      }

      .subtitle {
        font-family: var(--vscode-font-family);
        font-size: 10px;
        color: var(--vscode-descriptionForeground);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-weight: 700;
        white-space: nowrap;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }

      button {
        border: 1px solid transparent;
        border-radius: 999px;
        padding: 7px 12px;
        cursor: pointer;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        font-family: var(--vscode-font-family);
        font-size: 11.5px;
        font-weight: 700;
      }

      button.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border-color: var(--vscode-panel-border);
      }

      .metaRow {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .metaChip {
        display: inline-flex;
        align-items: center;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 999px;
        padding: 6px 10px;
        font-family: var(--vscode-font-family);
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-badge-background);
      }

      .sections {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        gap: 12px;
      }

      .card {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        padding: 14px;
        background: var(--vscode-editorWidget-background);
      }

      .sectionSummary {
        grid-column: span 12;
      }

      .sectionDetails {
        grid-column: span 8;
      }

      .sectionTakeaway {
        grid-column: span 4;
      }

      .sectionHeader {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 8px;
      }

      .sectionLabel {
        font-family: var(--vscode-font-family);
        font-size: 12.5px;
        color: var(--vscode-editor-foreground);
        font-weight: 800;
        letter-spacing: -0.01em;
      }

      .sectionCopy {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border-radius: 8px;
        background: transparent;
        color: var(--vscode-descriptionForeground);
        border: 1px solid var(--vscode-panel-border);
      }

      .sectionCopy:hover {
        background: var(--vscode-toolbar-hoverBackground);
        color: var(--vscode-editor-foreground);
      }

      .sectionCopy svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
      }

      .content {
        font-family: var(--vscode-font-family);
        font-size: 13.5px;
        line-height: 1.65;
        color: var(--vscode-editor-foreground);
      }

      .contentStrong {
        font-weight: 600;
      }

      .contentText {
        white-space: pre-wrap;
      }

      .important {
        display: inline-block;
        padding: 0 6px;
        margin: 0 1px;
        border-radius: 999px;
        background: color-mix(in srgb, var(--vscode-textLink-foreground) 14%, transparent);
        color: var(--vscode-textLink-foreground);
        font-weight: 700;
      }

      .inlineCode {
        display: inline-block;
        padding: 1px 6px;
        margin: 0 1px;
        border-radius: 6px;
        background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 72%, transparent);
        color: var(--vscode-textPreformat-foreground);
        font-family: var(--vscode-editor-font-family);
        font-size: 0.96em;
      }

      .error {
        border-color: var(--vscode-inputValidation-errorBorder);
      }

      .loading {
        opacity: 0.9;
      }

      .loadingPulse {
        position: relative;
        overflow: hidden;
      }

      .loadingPulse::after {
        content: "";
        position: absolute;
        inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--vscode-button-background) 18%, transparent), transparent);
        animation: sweep 1.4s infinite;
      }

      .hint {
        font-family: var(--vscode-font-family);
        font-size: 12px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.55;
      }

      .settingsFab {
        position: fixed;
        left: 16px;
        bottom: 16px;
        z-index: 10;
        border-radius: 999px;
        box-shadow: 0 8px 22px color-mix(in srgb, #000 22%, transparent);
      }

      .settingsView {
        border: 1px solid var(--vscode-panel-border);
        border-radius: 12px;
        padding: 14px;
        background: var(--vscode-editorWidget-background);
      }

      .settingsGrid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      .field {
        display: grid;
        gap: 6px;
      }

      .fieldWide {
        grid-column: span 2;
      }

      label {
        font-size: 11.5px;
        font-weight: 800;
        color: var(--vscode-descriptionForeground);
      }

      select,
      input {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--vscode-input-border);
        border-radius: 8px;
        padding: 8px 10px;
        color: var(--vscode-input-foreground);
        background: var(--vscode-input-background);
        font-family: var(--vscode-font-family);
        font-size: 12.5px;
      }

      input[type="checkbox"] {
        width: auto;
        margin-right: 6px;
      }

      .settingsActions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 14px;
      }

      .providerNote {
        margin-top: 12px;
        font-size: 12px;
        line-height: 1.55;
        color: var(--vscode-descriptionForeground);
      }

      .statusRow {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 14px;
        padding: 10px 12px;
        border: 1px solid var(--vscode-panel-border);
        border-radius: 10px;
        background: color-mix(in srgb, var(--vscode-editor-background) 72%, var(--vscode-editorWidget-background));
      }

      .statusLabel {
        font-size: 11.5px;
        font-weight: 800;
        color: var(--vscode-descriptionForeground);
      }

      .statusMessage {
        font-size: 12.5px;
        line-height: 1.5;
      }

      .statusMessage.statusSuccess {
        color: var(--vscode-testing-iconPassed);
      }

      .statusMessage.statusError {
        color: var(--vscode-errorForeground);
      }

      @keyframes sweep {
        to {
          transform: translateX(100%);
        }
      }

      @media (max-width: 720px) {
        .sectionSummary,
        .sectionDetails,
        .sectionTakeaway {
          grid-column: span 12;
        }

        .settingsGrid {
          grid-template-columns: 1fr;
        }

        .fieldWide {
          grid-column: span 1;
        }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <section class="hero ${input.loading ? "loadingPulse" : ""}">
        <div class="header">
          <div class="title">${escapeHtml(input.title)}</div>
          ${subtitle}
        </div>
        <div class="actions">
          <button data-action="moreSimple">${escapeHtml(text.moreSimple)}</button>
          <button data-action="moreDetailed">${escapeHtml(text.moreDetailed)}</button>
          <button class="secondary" data-action="retry">${escapeHtml(text.retry)}</button>
        </div>
      </section>
      ${bodyContent}
    </div>
    <button class="settingsFab" data-action="settings" title="${escapeHtml(text.settings)}" aria-label="${escapeHtml(text.settings)}">${escapeHtml(text.settingsButton)}</button>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const defaultModels = {
        ollama: "qwen2.5-coder",
        openai: "gpt-5",
        gemini: "gemini-2.5-flash",
        anthropic: "claude-sonnet-4-5"
      };
      const collectSettings = () => ({
        provider: document.querySelector("#provider")?.value,
        model: document.querySelector("#model")?.value,
        ollamaUrl: document.querySelector("#ollamaUrl")?.value,
        openAiBaseUrl: document.querySelector("#openAiBaseUrl")?.value,
        apiKey: document.querySelector("#apiKey")?.value,
        clearApiKey: document.querySelector("#clearApiKey")?.checked
      });
      const actions = document.querySelectorAll("[data-action]");
      for (const button of actions) {
        button.addEventListener("click", () => {
          const action = button.getAttribute("data-action");

          if (action === "saveSettings" || action === "checkSettingsConnection") {
            vscode.postMessage({
              action,
              settings: collectSettings()
            });
            return;
          }

          vscode.postMessage({ action });
        });
      }
      const provider = document.querySelector("#provider");
      const model = document.querySelector("#model");
      provider?.addEventListener("change", () => {
        if (model && !model.value.trim()) {
          model.value = defaultModels[provider.value] || "";
        }
      });
    </script>
  </body>
</html>`;
  }
}

function renderSettingsView(settings: SettingsViewModel, text: Record<string, string>): string {
  const keyStatus = settings.provider === "ollama" ? text.apiKeyNotNeeded : settings.hasApiKey ? text.apiKeyStored : text.apiKeyMissing;
  const statusClass =
    settings.providerStatus.kind === "success"
      ? "statusSuccess"
      : settings.providerStatus.kind === "error"
        ? "statusError"
        : "";

  return `<section class="settingsView">
    <div class="settingsGrid">
      <div class="field">
        <label for="provider">${escapeHtml(text.provider)}</label>
        <select id="provider">
          ${renderProviderOption("ollama", "Ollama local", settings.provider)}
          ${renderProviderOption("openai", "OpenAI / Codex", settings.provider)}
          ${renderProviderOption("gemini", "Gemini", settings.provider)}
          ${renderProviderOption("anthropic", "Claude", settings.provider)}
        </select>
      </div>
      <div class="field">
        <label for="model">${escapeHtml(text.model)}</label>
        <input id="model" value="${escapeHtml(settings.model)}" placeholder="qwen2.5-coder" />
      </div>
      <div class="field fieldWide">
        <label for="ollamaUrl">${escapeHtml(text.ollamaUrl)}</label>
        <input id="ollamaUrl" value="${escapeHtml(settings.ollamaUrl)}" placeholder="http://localhost:11434" />
      </div>
      <div class="field fieldWide">
        <label for="openAiBaseUrl">${escapeHtml(text.openAiBaseUrl)}</label>
        <input id="openAiBaseUrl" value="${escapeHtml(settings.openAiBaseUrl)}" placeholder="https://api.openai.com/v1" />
      </div>
      <div class="field fieldWide">
        <label for="apiKey">${escapeHtml(text.apiKey)} - ${escapeHtml(keyStatus)}</label>
        <input id="apiKey" type="password" value="${escapeHtml(settings.apiKey ?? "")}" placeholder="${escapeHtml(text.apiKeyPlaceholder)}" />
      </div>
      <div class="field fieldWide">
        <label>
          <input id="clearApiKey" type="checkbox" ${settings.clearApiKey ? "checked" : ""} />
          ${escapeHtml(text.clearApiKey)}
        </label>
      </div>
    </div>
    <div class="statusRow">
      <div>
        <div class="statusLabel">${escapeHtml(text.connectionStatus)}</div>
        <div class="statusMessage ${statusClass}">${escapeHtml(settings.providerStatus.message)}</div>
      </div>
      <button class="secondary" data-action="checkSettingsConnection">${escapeHtml(text.checkConnection)}</button>
    </div>
    <div class="providerNote">${escapeHtml(text.cloudPrivacyNote)}</div>
    <div class="providerNote">${escapeHtml(text.apiKeySecurityNote)}</div>
    <div class="settingsActions">
      <button data-action="saveSettings">${escapeHtml(text.saveSettings)}</button>
      <button class="secondary" data-action="cancelSettings">${escapeHtml(text.cancelSettings)}</button>
    </div>
  </section>`;
}

function renderProviderOption(value: string, label: string, selected: string): string {
  return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function renderSectionCard(
  section: SectionKey,
  label: string,
  content: string,
  isError: boolean,
  loading: boolean,
  isStrong: boolean
): string {
  const className =
    section === "summary"
      ? "sectionSummary"
      : section === "details"
        ? "sectionDetails"
        : "sectionTakeaway";

  return `<section class="card ${className} ${isError ? "error" : ""} ${loading ? "loading" : ""}">
    <div class="sectionHeader">
      <div class="sectionLabel">${escapeHtml(label)}</div>
      <button class="sectionCopy" data-action="copy:${section}" title="Copy" aria-label="Copy ${escapeHtml(label)}">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M5 2.75A1.75 1.75 0 0 1 6.75 1h5.5A1.75 1.75 0 0 1 14 2.75v7.5A1.75 1.75 0 0 1 12.25 12h-5.5A1.75 1.75 0 0 1 5 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
          <path d="M2 5.75C2 4.784 2.784 4 3.75 4h.5v1.5h-.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-.5H11v.5A1.75 1.75 0 0 1 9.25 14h-5.5A1.75 1.75 0 0 1 2 12.25Z"></path>
        </svg>
      </button>
    </div>
    <div class="content ${isStrong ? "contentStrong " : ""}contentText">${renderRichText(content)}</div>
  </section>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getNonce(): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";

  for (let index = 0; index < 16; index += 1) {
    value += characters.charAt(Math.floor(Math.random() * characters.length));
  }

  return value;
}

function buildMetadata(context: CodeContext, language: UiLanguage): string[] {
  const lineLabel =
    context.startLine === context.endLine
      ? language === "en"
        ? `line ${context.startLine}`
        : `ligne ${context.startLine}`
      : language === "en"
        ? `lines ${context.startLine}-${context.endLine}`
        : `lignes ${context.startLine}-${context.endLine}`;

  const metadata = [context.fileName, context.languageId, lineLabel];
  if (context.relatedSnippets.length > 0) {
    metadata.push(language === "en" ? `${context.relatedSnippets.length} linked snippets` : `${context.relatedSnippets.length} extraits liés`);
  }
  return metadata;
}

function renderRichText(value: string): string {
  const pieces = value.split(/(\[\[[^[\]]+?\]\]|`[^`]+`)/g);
  return pieces
    .map((piece) => {
      if (piece.startsWith("[[") && piece.endsWith("]]")) {
        return `<span class="important">${escapeHtml(piece.slice(2, -2).trim())}</span>`;
      }

      if (piece.startsWith("`") && piece.endsWith("`")) {
        return `<span class="inlineCode">${escapeHtml(piece.slice(1, -1).trim())}</span>`;
      }

      return escapeHtml(piece);
    })
    .join("");
}

function getUiText(language: UiLanguage): Record<string, string> {
  if (language === "en") {
    return {
      appName: "XPlanator",
      ready: "Ready",
      analyzing: "Analyzing",
      error: "Error",
      emptySummary: "Select code or place your cursor on a line to get an immediate explanation.",
      emptyDetails:
        "You can launch an explanation from the context menu, the command palette, or the status bar button. The extension stays local and sends code only to Ollama on your machine.",
      emptyTakeaway: "The goal is simple: understand a piece of code without breaking your reading flow.",
      loadingSummary: "Reading the selected code.",
      loadingTakeaway: "Keep the file context open. The answer will appear here.",
      errorSummary: "I could not generate the explanation.",
      errorTakeaway: "You can retry or check the Ollama connection.",
      moreSimple: "Simpler",
      moreDetailed: "More detail",
      retry: "Retry",
      settings: "Settings",
      settingsButton: "Settings",
      generalIdea: "Big picture",
      details: "Details",
      takeaway: "Key takeaway",
      hint: "Tip: select only the part that blocks you to get a sharper explanation.",
      provider: "Provider",
      model: "Model",
      ollamaUrl: "Ollama URL",
      openAiBaseUrl: "OpenAI-compatible base URL",
      apiKey: "API key",
      apiKeyPlaceholder: "Leave empty to keep the saved key",
      apiKeyNotNeeded: "not needed for Ollama",
      apiKeyStored: "key already saved",
      apiKeyMissing: "no key saved",
      clearApiKey: "Delete the saved API key for this provider",
      connectionStatus: "Connection status",
      checkConnection: "Check connection",
      cloudPrivacyNote: "Cloud providers receive the code you ask XPlanator to explain. Use Ollama if you want everything to stay local.",
      apiKeySecurityNote: "API keys are never displayed again after saving and are stored with VS Code SecretStorage.",
      saveSettings: "Save",
      cancelSettings: "Cancel",
      noDistinctSummary: "The model did not provide a separate summary.",
      defaultTakeaway: "The main idea is already captured in the details above.",
      explanationAvailableBelow: "Explanation available below.",
      reviewTakeaway: "Re-read the target snippet and the details to confirm your understanding."
    };
  }

  return {
    appName: "XPlanator",
    ready: "Prêt",
    analyzing: "Analyse en cours",
    error: "Erreur",
    emptySummary: "Sélectionne du code ou pose ton curseur sur une ligne pour obtenir une explication immédiate.",
    emptyDetails:
      "Tu peux lancer l'explication depuis le clic droit, la palette de commandes, ou le bouton dans la barre de statut. L'extension reste locale et envoie le code uniquement à Ollama sur ta machine.",
    emptyTakeaway: "Le but est simple : comprendre un bout de code sans casser ton flux de lecture.",
    loadingSummary: "Je lis le code sélectionné.",
    loadingTakeaway: "Garde le contexte ouvert, la réponse arrive ici.",
    errorSummary: "Je n'ai pas pu générer l'explication.",
    errorTakeaway: "Tu peux réessayer ou vérifier la connexion Ollama.",
    moreSimple: "Plus simple",
    moreDetailed: "Plus détaillé",
    retry: "Réessayer",
    settings: "Paramètres",
    settingsButton: "Paramètres",
    generalIdea: "Idée générale",
    details: "Détails",
    takeaway: "À retenir",
    hint: "Astuce : sélectionne juste la partie qui te bloque pour obtenir une explication plus nette.",
    provider: "Fournisseur",
    model: "Modèle",
    ollamaUrl: "URL Ollama",
    openAiBaseUrl: "URL de base compatible OpenAI",
    apiKey: "Clé API",
    apiKeyPlaceholder: "Laisse vide pour garder la clé enregistrée",
    apiKeyNotNeeded: "inutile avec Ollama",
    apiKeyStored: "clé déjà enregistrée",
    apiKeyMissing: "aucune clé enregistrée",
    clearApiKey: "Supprimer la clé API enregistrée pour ce fournisseur",
    connectionStatus: "Etat de la connexion",
    checkConnection: "Verifier la connexion",
    cloudPrivacyNote:
      "Les fournisseurs cloud reçoivent le code que tu demandes à XPlanator d'expliquer. Utilise Ollama si tu veux tout garder en local.",
    apiKeySecurityNote: "Les clés API ne sont jamais réaffichées après l'enregistrement et sont stockées avec le SecretStorage de VS Code.",
    saveSettings: "Enregistrer",
    cancelSettings: "Annuler",
    noDistinctSummary: "Le modèle n'a pas fourni de résumé distinct.",
    defaultTakeaway: "L'idée principale est déjà dans les détails ci-dessus.",
    explanationAvailableBelow: "Explication disponible ci-dessous.",
    reviewTakeaway: "Relis surtout le bloc cible et les détails pour confirmer ton intuition."
  };
}
