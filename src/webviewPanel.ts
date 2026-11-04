import * as vscode from "vscode";
import { ExplanationSections, parseExplanation, stripHighlightMarkers } from "./explanationParser";
import { CodeContext, ExplanationSection, ModelSettingsInput, ProviderConnectionStatus, UiLanguage } from "./types";

type SectionKey = "summary" | "details" | "takeaway";
type PanelAction =
  | "moreSimple"
  | "moreDetailed"
  | "retry"
  | "cancelGeneration"
  | "streamReady"
  | "settings"
  | "profiles"
  | "history"
  | "askQuestion"
  | "questionDraft"
  | "example"
  | "saveSettings"
  | "cancelSettings"
  | "checkSettingsConnection"
  | "testGeneration"
  | "listModels"
  | "setExplanationSections"
  | `copy:${SectionKey}`;

export interface PanelMessage {
  action?: PanelAction;
  settings?: ModelSettingsInput;
  requestId?: number;
  explanationSections?: ExplanationSection[];
  question?: string;
}

interface PanelState {
  codeContext: CodeContext;
  explanation: string;
  sourceStatus?: string;
  usageInfo?: string;
}

interface SettingsViewModel extends ModelSettingsInput {
  profileName: string;
  hasApiKey: boolean;
  providerStatus: ProviderConnectionStatus;
}

const allExplanationSections: ExplanationSection[] = ["summary", "details", "takeaway"];

export class ExplanationPanel {
  private panel: vscode.WebviewPanel | undefined;
  private latestState: PanelState | undefined;
  private latestSections: ExplanationSections | undefined;
  private streamedText = "";
  private questionDraft = "";
  private view: "settings" | "explanation" | "loading" = "explanation";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly onAction: (message: PanelMessage) => void,
    private readonly getActiveModel: () => string = () => ""
  ) {}

  showEmptyState(language: UiLanguage, explanationSections: ExplanationSection[] = allExplanationSections): void {
    this.view = "explanation";
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
      loading: false,
      explanationSections
    });
    this.revealPanel(panel);
  }

  showLoading(message: string, language: UiLanguage, explanationSections: ExplanationSection[], context?: CodeContext): void {
    this.view = "loading";
    this.streamedText = "";
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
      metadata: context ? buildMetadata(context, language) : [],
      sections,
      isError: false,
      loading: true,
      explanationSections
    });
    this.revealPanel(panel);
  }

  showExplanation(state: PanelState, language: UiLanguage, explanationSections: ExplanationSection[], preserveSettings = false): void {
    this.latestState = state;
    const text = getUiText(language);
    const sections = parseExplanation(state.explanation, language);
    this.latestSections = sections;
    if (preserveSettings && this.view === "settings") return;
    this.view = "explanation";
    const panel = this.ensurePanel();
    // A provider may ignore requested headings. Never hide the only answer.
    const visibleSections = explanationSections.some(section => Boolean(sections[section]))
      ? explanationSections : allExplanationSections.filter(section => Boolean(sections[section]));
    panel.title = text.appName;
    panel.webview.html = this.renderHtml({
      language,
      title: text.appName,
      subtitle: "",
      metadata: [...buildMetadata(state.codeContext, language), ...(state.usageInfo ? [state.usageInfo] : [])],
      sourceStatus: state.sourceStatus,
      sections,
      isError: false,
      loading: false,
      explanationSections: visibleSections
    });
    this.revealPanel(panel);
  }

  showError(
    message: string,
    language: UiLanguage,
    codeContext?: CodeContext,
    explanationSections: ExplanationSection[] = allExplanationSections
  ): void {
    if (this.view === "settings") return;
    this.view = "explanation";
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
      loading: false,
      explanationSections
    });
    this.revealPanel(panel);
  }

  showSettings(settings: SettingsViewModel, language: UiLanguage): void {
    this.view = "settings";
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
      settings,
      explanationSections: settings.explanationSections ?? allExplanationSections
    });
    this.revealPanel(panel);
  }

  sendModels(requestId: number | undefined, models: string[], error?: string): void {
    void this.panel?.webview.postMessage({ action: "models", requestId, models, error });
  }

  sendConnectionStatus(status: ProviderConnectionStatus, requestId?: number): void {
    void this.panel?.webview.postMessage({ action: "connectionStatus", status, requestId });
  }

  appendStream(text: string): void {
    this.streamedText += text;
    this.sendStreamSnapshot();
  }

  sendStreamSnapshot(): void {
    void this.panel?.webview.postMessage({ action: "stream", text: this.streamedText });
  }

  setQuestionDraft(value: string): void { this.questionDraft = value.slice(0, 4000); }

  setSourceStatus(value: string | undefined): void {
    if (this.latestState) this.latestState.sourceStatus = value;
    void this.panel?.webview.postMessage({ action: "sourceStatus", value: value ?? "" });
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

  private revealPanel(panel: vscode.WebviewPanel): void {
    if (panel.visible) {
      return;
    }

    panel.reveal(panel.viewColumn ?? vscode.ViewColumn.Beside, true);
  }

  private renderHtml(input: {
    language: UiLanguage;
    title: string;
    subtitle: string;
    metadata: string[];
    sourceStatus?: string;
    sections: ExplanationSections;
    isError: boolean;
    loading: boolean;
    explanationSections?: ExplanationSection[];
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

    const selectedSections = normalizeExplanationSections(input.explanationSections);
    const bodyContent = input.settings
      ? renderSettingsView(input.settings, text)
      : input.loading
      ? `${metadata}<div id="streamOutput" class="card contentText" role="status" aria-live="polite"></div>`
      : `${metadata}<div id="sourceStatus" class="providerNote" role="status">${escapeHtml(input.sourceStatus ?? "")}</div>
      <div class="sections">
        ${allExplanationSections
          .map((section) =>
            renderSectionCard(
              section,
              getSectionLabel(section, text),
              selectedSections.includes(section) ? input.sections[section] : text.sectionDisabled,
              input.isError,
              input.loading,
              section === "summary",
              selectedSections.includes(section)
            )
          )
          .join("")}
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
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: 10px;
      }

      .heading {
        min-width: 0;
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
        transition:
          background-color 120ms ease,
          border-color 120ms ease,
          color 120ms ease,
          transform 80ms ease,
          box-shadow 120ms ease;
      }

      button:hover {
        background: color-mix(in srgb, var(--vscode-button-background) 82%, white);
        box-shadow: 0 6px 16px color-mix(in srgb, #000 20%, transparent);
      }

      button:active,
      button.isPressed {
        background: color-mix(in srgb, var(--vscode-button-background) 72%, black);
        transform: translateY(1px);
        box-shadow: inset 0 0 0 999px color-mix(in srgb, #000 10%, transparent);
      }

      button:focus-visible {
        outline: 2px solid var(--vscode-focusBorder);
        outline-offset: 2px;
      }

      button.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border-color: var(--vscode-panel-border);
      }

      button.secondary:hover {
        background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 82%, white);
        border-color: var(--vscode-focusBorder);
      }

      button.secondary:active,
      button.secondary.isPressed {
        background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 72%, black);
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
        justify-self: end;
        align-self: start;
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

      .field[hidden] { display: none; }
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
        accent-color: var(--vscode-button-background);
        width: auto;
        margin-right: 6px;
      }

      .sectionToggle {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
      }

      .sectionToggle input {
        flex: 0 0 auto;
        margin: 0;
      }

      .sectionMuted {
        opacity: 0.68;
      }

      .sectionMuted .content {
        color: var(--vscode-descriptionForeground);
      }

      .settingsActions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
        margin-bottom: 14px;
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
        .header {
          grid-template-columns: 1fr;
        }

        .settingsFab {
          justify-self: start;
        }

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
      /* Follow the editor theme and give explanations a single reading column. */
      body { padding: 16px; font-size: var(--vscode-font-size); }
      .layout { max-width: 760px; gap: 14px; }
      .layout > *, .settingsView, .field, .statusRow > * { min-width: 0; }
      .hero { border: 0; border-bottom: 1px solid var(--vscode-panel-border); border-radius: 0; padding: 0 0 12px; background: transparent; }
      .title { font-size: 16px; font-weight: 650; }
      .subtitle { font-size: 12px; text-transform: none; letter-spacing: normal; white-space: normal; font-weight: 400; }
      .modelLabel { margin-top: 4px; color: var(--vscode-descriptionForeground); font-size: 12px; overflow-wrap: anywhere; }
      .sections { display: flex; flex-direction: column; gap: 0; }
      .card { border: 0; border-bottom: 1px solid var(--vscode-panel-border); border-radius: 0; padding: 15px 0; background: transparent; }
      .sectionLabel { font-size: 13px; font-weight: 600; }
      .content { font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
      .contentStrong { font-weight: 400; }
      .metaChip { padding: 2px 0; border: 0; border-radius: 0; background: transparent; }
      .metaRow { column-gap: 14px; }
      button { border-radius: 4px; padding: 5px 9px; font-size: 12px; font-weight: 500; box-shadow: none; }
      .settingsFab { border-radius: 4px; box-shadow: none; }
      button { max-width: 100%; white-space: normal; }
      button:hover { background: var(--vscode-button-hoverBackground); box-shadow: none; }
      button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); box-shadow: none; }
      .actions { margin: 0; }
      .statusRow { gap: 8px; flex-wrap: wrap; }
      .providerNote { overflow-wrap: anywhere; }
      .preferenceGroup { margin-top: 14px; border-top: 1px solid var(--vscode-panel-border); padding-top: 12px; }
      .preferenceGroup summary, details.field > summary { cursor: pointer; font-weight: 600; margin-bottom: 10px; }
      #question { flex: 1; min-width: 0; }
      input:focus-visible, select:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
    </style>
  </head>
  <body>
    <div class="layout">
      <section class="hero ${input.loading ? "loadingPulse" : ""}">
        <div class="header">
          <div class="heading">
            <div class="title">${escapeHtml(input.title)}</div>
            ${subtitle}
            ${this.getActiveModel() ? `<div class="modelLabel">${escapeHtml(this.getActiveModel())}</div>` : ""}
          </div>
          <div><button class="secondary" data-action="history">${input.language === "fr" ? "Historique" : "History"}</button>
          <button class="settingsFab" data-action="settings" title="${escapeHtml(text.settings)}" aria-label="${escapeHtml(text.settings)}">${escapeHtml(text.settingsButton)}</button></div>
        </div>
      </section>
      ${bodyContent}
      <div class="actions">
          ${input.loading ? `<button class="secondary" data-action="cancelGeneration">${input.language === "fr" ? "Annuler" : "Cancel"}</button>` : ""}
          ${!input.loading && this.latestState && !input.settings ? `
          <button data-action="moreSimple">${escapeHtml(text.moreSimple)}</button>
          <button data-action="moreDetailed">${escapeHtml(text.moreDetailed)}</button>
          <button data-action="example">${input.language === "fr" ? "Donner un exemple" : "Give an example"}</button>
          ` : ""}
          ${!input.loading && !input.settings && (this.latestState || input.isError) ? `<button class="secondary" data-action="retry">${escapeHtml(text.retry)}</button>` : ""}
      </div>
      ${!input.loading && this.latestState && !input.settings ? `<form id="questionForm" class="statusRow"><input id="question" maxlength="4000" value="${escapeHtml(this.questionDraft)}" aria-label="${input.language === "fr" ? "Question sur le code" : "Question about the code"}" placeholder="${input.language === "fr" ? "Posez une question sur ce code…" : "Ask a question about this code…"}" required /><button type="submit">${input.language === "fr" ? "Envoyer" : "Ask"}</button></form>` : ""}
    </div>
    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      document.querySelector("#questionForm")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const question = document.querySelector("#question")?.value.trim();
        if (question) vscode.postMessage({ action: "askQuestion", question });
      });
      document.querySelector("#question")?.addEventListener("input", (event) => {
        vscode.postMessage({ action: "questionDraft", question: event.target.value });
      });
      const collectSettings = () => {
        const apiKeyInput = document.querySelector("#apiKey");
        return {
          provider: document.querySelector("#provider")?.value,
          model: document.querySelector("#model")?.value,
          ollamaUrl: document.querySelector("#ollamaUrl")?.value,
          openAiBaseUrl: document.querySelector("#openAiBaseUrl")?.value,
          anthropicBaseUrl: document.querySelector("#anthropicBaseUrl")?.value,
          language: document.querySelector("#language")?.value,
          responseStyle: document.querySelector("#responseStyle")?.value,
          responseLength: document.querySelector("#responseLength")?.value,
          maxSurroundingLines: Number(document.querySelector("#maxSurroundingLines")?.value),
          includeRelatedContext: document.querySelector("#includeRelatedContext")?.checked,
          maxRelatedSnippets: Number(document.querySelector("#maxRelatedSnippets")?.value),
          maxRelatedLinesPerSnippet: Number(document.querySelector("#maxRelatedLinesPerSnippet")?.value),
          maxContextCharacters: Number(document.querySelector("#maxContextCharacters")?.value),
          timeoutSeconds: Number(document.querySelector("#timeoutSeconds")?.value),
          apiKey: apiKeyInput?.value ?? "",
          clearApiKey: document.querySelector("#clearApiKey")?.checked
        };
      };
      const collectExplanationSections = () => {
        return Array.from(document.querySelectorAll("[data-explanation-section]:checked")).map((input) => input.value);
      };
      let modelRequestId = 0;
      const modelSelect = document.querySelector("#availableModels");
      const modelStatus = document.querySelector("#modelStatus");
      window.addEventListener("message", (event) => {
        const message = event.data;
        if (message.action === "stream") {
          const output = document.querySelector("#streamOutput");
          if (output) output.textContent = message.text;
          return;
        }
        if (message.action === "sourceStatus") {
          const status = document.querySelector("#sourceStatus");
          if (status) status.textContent = message.value;
          return;
        }
        if (message.action === "connectionStatus") {
          if (message.requestId !== modelRequestId) return;
          const status = document.querySelector(".statusMessage");
          if (status) { status.textContent = message.status.message; status.className = "statusMessage " + (message.status.kind === "success" ? "statusSuccess" : "statusError"); }
          return;
        }
        if (message.action !== "models" || message.requestId !== modelRequestId || !modelSelect || !modelStatus) return;
        modelSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = ${JSON.stringify(input.language === "fr" ? "Choisir un modèle" : "Choose a model")};
        modelSelect.appendChild(placeholder);
        for (const id of message.models) {
          const option = document.createElement("option");
          option.value = id; option.textContent = id; modelSelect.appendChild(option);
        }
        modelSelect.disabled = !message.models.length;
        modelStatus.textContent = message.error || (message.models.length
          ? ${JSON.stringify(input.language === "fr" ? "Choisissez un modèle dans la liste. Sa disponibilité dépend aussi de votre compte et de ses droits." : "Choose a model. Availability also depends on your account and permissions.")}
          : ${JSON.stringify(input.language === "fr" ? "Aucun modèle trouvé. Vous pouvez saisir son nom manuellement." : "No models found. You can enter a model manually.")});
        const button = document.querySelector('[data-action="listModels"]');
        if (button) button.disabled = false;
      });
      for (const selector of ["#apiKey", "#openAiBaseUrl", "#anthropicBaseUrl", "#ollamaUrl"]) {
        document.querySelector(selector)?.addEventListener("input", () => {
          modelRequestId++;
          if (modelSelect) { modelSelect.replaceChildren(); modelSelect.disabled = true; }
          if (modelStatus) modelStatus.textContent = "";
          const button = document.querySelector('[data-action="listModels"]');
          if (button) button.disabled = false;
        });
      }
      modelSelect?.addEventListener("change", () => {
        const input = document.querySelector("#model");
        if (input && modelSelect.value) input.value = modelSelect.value;
      });
      const actions = document.querySelectorAll("[data-action]");
      for (const button of actions) {
        button.addEventListener("click", () => {
          button.classList.add("isPressed");
          setTimeout(() => button.classList.remove("isPressed"), 180);
          const action = button.getAttribute("data-action");

          if (action === "listModels") {
            modelRequestId++;
            button.disabled = true;
            if (modelStatus) modelStatus.textContent = ${JSON.stringify(input.language === "fr" ? "Chargement des modèles…" : "Loading models…")};
            vscode.postMessage({ action, requestId: modelRequestId, settings: collectSettings() });
            return;
          }
          if (action === "saveSettings" || action === "checkSettingsConnection" || action === "testGeneration") {
            if (action !== "saveSettings") modelRequestId++;
            vscode.postMessage({
              action,
              requestId: modelRequestId,
              settings: collectSettings()
            });
            return;
          }

          vscode.postMessage({ action });
        });
      }
      const sectionToggles = document.querySelectorAll("[data-explanation-section]");
      for (const toggle of sectionToggles) {
        toggle.addEventListener("change", () => {
          if (collectExplanationSections().length === 0) {
            toggle.checked = true;
          }

          vscode.postMessage({
            action: "setExplanationSections",
            explanationSections: collectExplanationSections()
          });
        });
      }
      const provider = document.querySelector("#provider");
      const model = document.querySelector("#model");
      model?.addEventListener("input", () => {
        modelRequestId++;
        const query = model.value.trim().toLocaleLowerCase();
        for (const option of modelSelect?.options ?? []) {
          option.hidden = Boolean(option.value) && !option.value.toLocaleLowerCase().includes(query);
        }
      });
      const apiKey = document.querySelector("#apiKey");
      const clearApiKey = document.querySelector("#clearApiKey");
      let previousProvider = provider?.value;
      const draftModels = {};
      const refreshProviderFields = () => {
        const needsApiKey = provider?.value !== "ollama";
        for (const [id, owner] of [["ollamaUrl", "ollama"], ["openAiBaseUrl", "openai"], ["anthropicBaseUrl", "anthropic"]]) {
          const field = document.querySelector("#" + id)?.closest(".field");
          if (field) field.hidden = provider?.value !== owner;
        }
        if (model) {
          model.disabled = false;
        }
        if (apiKey) {
          apiKey.disabled = !needsApiKey;
          if (!needsApiKey) {
            apiKey.value = "";
          }
        }
        if (clearApiKey) {
          clearApiKey.disabled = !needsApiKey;
          if (!needsApiKey) {
            clearApiKey.checked = false;
          }
        }
      };
      provider?.addEventListener("change", () => {
        modelRequestId++;
        if (modelSelect) { modelSelect.replaceChildren(); modelSelect.disabled = true; }
        if (modelStatus) modelStatus.textContent = "";
        const loadButton = document.querySelector('[data-action="listModels"]');
        if (loadButton) loadButton.disabled = false;
        if (model) {
          if (previousProvider) draftModels[previousProvider] = model.value;
          model.value = draftModels[provider.value] || "";
        }
        if (apiKey) apiKey.value = "";
        if (clearApiKey) clearApiKey.checked = false;
        const keyLabel = document.querySelector("label[for=apiKey]");
        if (keyLabel) keyLabel.textContent = ${JSON.stringify(text.apiKey)};
        const status = document.querySelector(".statusMessage");
        if (status) { status.textContent = ""; status.className = "statusMessage"; }
        previousProvider = provider.value;
        refreshProviderFields();
      });
      refreshProviderFields();
      if (document.querySelector("#streamOutput")) vscode.postMessage({ action: "streamReady" });
    </script>
  </body>
</html>`;
  }
}

function renderSettingsView(settings: SettingsViewModel, text: Record<string, string>): string {
  const requiresApiKey = settings.provider !== "ollama";
  const keyStatus = !requiresApiKey ? text.apiKeyNotNeeded : settings.hasApiKey ? text.apiKeyStored : text.apiKeyMissing;
  const statusClass =
    settings.providerStatus.kind === "success"
      ? "statusSuccess"
      : settings.providerStatus.kind === "error"
        ? "statusError"
        : "";

  return `<section class="settingsView">
    <div class="statusRow"><div><strong>${escapeHtml(settings.profileName)}</strong></div>
      <button class="secondary" data-action="profiles">${text.profileManage}</button></div>
    <div class="settingsGrid">
      <div class="field">
        <label for="provider">${escapeHtml(text.provider)}</label>
        <select id="provider" disabled>
          ${renderProviderOption("ollama", "Ollama local", settings.provider)}
          ${renderProviderOption("openai", "OpenAI / Codex", settings.provider)}
          ${renderProviderOption("meta", "Meta Muse", settings.provider)}
          ${renderProviderOption("gemini", "Gemini", settings.provider)}
          ${renderProviderOption("anthropic", "Claude", settings.provider)}
        </select>
      </div>
      <div class="field">
        <label for="model">${escapeHtml(text.model)}</label>
        <input id="model" value="${escapeHtml(settings.model)}" placeholder="${escapeHtml(text.chooseModel)}" />
        <button type="button" class="secondary" data-action="listModels">${escapeHtml(text.loadModels)}</button>
        <select id="availableModels" disabled aria-label="${escapeHtml(text.chooseModel)}"></select>
        <div id="modelStatus" role="status"></div>
      </div>
      <details class="field fieldWide"><summary>${text.advanced}</summary>
      <div class="field fieldWide">
        <label for="ollamaUrl">${escapeHtml(text.ollamaUrl)}</label>
        <input id="ollamaUrl" value="${escapeHtml(settings.ollamaUrl)}" placeholder="http://localhost:11434" />
      </div>
      <div class="field fieldWide">
        <label for="openAiBaseUrl">${escapeHtml(text.openAiBaseUrl)}</label>
        <input id="openAiBaseUrl" value="${escapeHtml(settings.openAiBaseUrl)}" placeholder="https://api.openai.com/v1" />
      </div>
      <div class="field fieldWide">
        <label for="anthropicBaseUrl">${escapeHtml(text.anthropicBaseUrl)}</label>
        <input id="anthropicBaseUrl" value="${escapeHtml(settings.anthropicBaseUrl)}" placeholder="https://api.anthropic.com/v1" />
      </div>
      <div class="field"><label for="timeoutSeconds">${text.timeout}</label><input id="timeoutSeconds" type="number" min="5" max="180" value="${settings.timeoutSeconds ?? 60}" /></div>
      </details>
      <div class="field fieldWide">
        <label for="apiKey">${escapeHtml(text.apiKey)} - ${escapeHtml(keyStatus)}</label>
        <input id="apiKey" type="password" value="${escapeHtml(settings.apiKey ?? "")}" placeholder="${escapeHtml(text.apiKeyPlaceholder)}" data-key-saved="${requiresApiKey && settings.hasApiKey ? "true" : "false"}" ${requiresApiKey ? "" : "disabled"} />
      </div>
      <div class="field fieldWide">
        <label>
          <input id="clearApiKey" type="checkbox" ${settings.clearApiKey ? "checked" : ""} ${requiresApiKey ? "" : "disabled"} />
          ${escapeHtml(text.clearApiKey)}
        </label>
      </div>
    </div>
    <details class="preferenceGroup" open><summary>${text.explanationPreferences}</summary>
      <div class="settingsGrid">
        <div class="field"><label for="language">${text.language}</label><select id="language">${renderProviderOption("fr", "Français", settings.language ?? "fr")}${renderProviderOption("en", "English", settings.language ?? "fr")}</select></div>
        <div class="field"><label for="responseStyle">${text.level}</label><select id="responseStyle">${renderProviderOption("beginner", text.beginner, settings.responseStyle ?? "beginner")}${renderProviderOption("simple", text.intermediate, settings.responseStyle ?? "beginner")}${renderProviderOption("technical", text.advancedLevel, settings.responseStyle ?? "beginner")}</select></div>
        <div class="field"><label for="responseLength">${text.length}</label><select id="responseLength">${renderProviderOption("short", text.short, settings.responseLength ?? "medium")}${renderProviderOption("medium", text.medium, settings.responseLength ?? "medium")}${renderProviderOption("long", text.long, settings.responseLength ?? "medium")}</select></div>
      </div>
    </details>
    <details class="preferenceGroup"><summary>${text.contextPreferences}</summary>
      <div class="settingsGrid">
        <div class="field"><label for="maxSurroundingLines">${text.surroundingLines}</label><input id="maxSurroundingLines" type="number" min="10" max="200" value="${settings.maxSurroundingLines ?? 20}" /></div>
        <div class="field"><label><input id="includeRelatedContext" type="checkbox" ${settings.includeRelatedContext ? "checked" : ""} /> ${text.related}</label></div>
        <div class="field"><label for="maxRelatedSnippets">${text.relatedCount}</label><input id="maxRelatedSnippets" type="number" min="0" max="8" value="${settings.maxRelatedSnippets ?? 0}" /></div>
        <div class="field"><label for="maxRelatedLinesPerSnippet">${text.relatedLines}</label><input id="maxRelatedLinesPerSnippet" type="number" min="8" max="80" value="${settings.maxRelatedLinesPerSnippet ?? 28}" /></div>
        <div class="field"><label for="maxContextCharacters">${text.contextBudget}</label><input id="maxContextCharacters" type="number" min="4000" max="120000" value="${settings.maxContextCharacters ?? 8000}" /></div>
      </div>
    </details>
    <div class="settingsActions">
      <button data-action="saveSettings">${escapeHtml(text.saveSettings)}</button>
      <button class="secondary" data-action="cancelSettings">${escapeHtml(text.cancelSettings)}</button>
    </div>
    <div class="statusRow">
      <div>
        <div class="statusLabel">${escapeHtml(text.connectionStatus)}</div>
        <div class="statusMessage ${statusClass}">${escapeHtml(settings.providerStatus.message)}</div>
      </div>
      <button class="secondary" data-action="checkSettingsConnection">${escapeHtml(text.checkConnection)}</button>
      <button class="secondary" data-action="testGeneration">${escapeHtml(text.testGeneration)}</button>
    </div>
    <div class="providerNote">${escapeHtml(text.cloudPrivacyNote)}</div>
    <div class="providerNote">${escapeHtml(text.apiKeySecurityNote)}</div>
  </section>`;
}

function renderProviderOption(value: string, label: string, selected: string): string {
  return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function renderSectionCard(
  section: ExplanationSection,
  label: string,
  content: string,
  isError: boolean,
  loading: boolean,
  isStrong: boolean,
  selected: boolean
): string {
  const className =
    section === "summary"
      ? "sectionSummary"
      : section === "details"
        ? "sectionDetails"
        : "sectionTakeaway";

  return `<section class="card ${className} ${isError ? "error" : ""} ${loading ? "loading" : ""} ${selected ? "" : "sectionMuted"}">
    <div class="sectionHeader">
      <label class="sectionToggle">
        <input type="checkbox" value="${section}" data-explanation-section ${selected ? "checked" : ""} />
        <span class="sectionLabel">${escapeHtml(label)}</span>
      </label>
      ${selected && content ? `<button class="sectionCopy" data-action="copy:${section}" title="Copy" aria-label="Copy ${escapeHtml(label)}">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 2.75A1.75 1.75 0 0 1 6.75 1h5.5A1.75 1.75 0 0 1 14 2.75v7.5A1.75 1.75 0 0 1 12.25 12h-5.5A1.75 1.75 0 0 1 5 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path>
            <path d="M2 5.75C2 4.784 2.784 4 3.75 4h.5v1.5h-.5a.25.25 0 0 0-.25.25v6.5c0 .138.112.25.25.25h5.5a.25.25 0 0 0 .25-.25v-.5H11v.5A1.75 1.75 0 0 1 9.25 14h-5.5A1.75 1.75 0 0 1 2 12.25Z"></path>
          </svg>
        </button>` : ""}
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

  const metadata = [context.fileName, ...(context.symbolUnderCursor ? [context.symbolUnderCursor] : []), context.languageId, lineLabel];
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

function normalizeExplanationSections(sections: readonly ExplanationSection[] | undefined): ExplanationSection[] {
  const selectedSections = allExplanationSections.filter((section) => sections?.includes(section));
  return selectedSections.length ? selectedSections : ["summary"];
}

function getSectionLabel(section: ExplanationSection, text: Record<string, string>): string {
  switch (section) {
    case "details":
      return text.details;
    case "takeaway":
      return text.takeaway;
    case "summary":
    default:
      return text.generalIdea;
  }
}

function getFrenchUiText(): Record<string, string> {
  return {
    appName: "XPlanator",
    ready: "Prêt",
    analyzing: "Analyse en cours",
    error: "Erreur",
    emptySummary: "Sélectionne du code ou place le curseur sur une ligne pour obtenir une explication.",
    emptyDetails:
      "Tu peux lancer l'explication depuis le clic droit, la palette de commandes, ou le bouton dans la barre de statut. Choisis OpenAI/Codex, Claude, Gemini ou Ollama dans les parametres.",
    emptyTakeaway: "Le but est simple : comprendre un bout de code sans casser ton flux de lecture.",
    loadingSummary: "Lecture du code sélectionné.",
    loadingTakeaway: "La réponse arrive ici.",
    errorSummary: "Impossible de générer l'explication.",
    errorTakeaway: "Réessaie ou vérifie la connexion du fournisseur configuré.",
    sectionDisabled: "Cette section ne sera pas demandée lors de la prochaine explication.",
    moreSimple: "Plus simple",
    moreDetailed: "Approfondir",
    retry: "Réessayer",
    settings: "Paramètres",
    settingsButton: "Paramètres",
    generalIdea: "Résumé",
    details: "Fonctionnement",
    takeaway: "À retenir",
    hint: "Sélectionne la partie à comprendre pour cibler l’explication.",
    loadModels: "Charger les modèles disponibles",
    chooseModel: "Modèles disponibles",
    provider: "Fournisseur",
    model: "Modèle",
    explanationSections: "Sections à générer",
    ollamaUrl: "URL Ollama",
    openAiBaseUrl: "URL de base compatible OpenAI",
    anthropicBaseUrl: "URL de base compatible Anthropic",
    apiKey: "Clé API",
    apiKeyPlaceholder: "Laisse vide pour garder la clé enregistrée",
    apiKeyNotNeeded: "inutile avec Ollama",
    apiKeyStored: "clé déjà enregistrée",
    apiKeyMissing: "aucune clé enregistrée",
    clearApiKey: "Supprimer la clé API enregistrée pour ce profil",
    connectionStatus: "État de la connexion",
    checkConnection: "Vérifier la connexion",
    testGeneration: "Tester la génération",
    profileManage: "Changer ou gérer les profils",
    advanced: "Options avancées",
    timeout: "Délai (secondes)", explanationPreferences: "Explication", language: "Langue", level: "Niveau pédagogique",
    beginner: "Débutant", intermediate: "Intermédiaire", advancedLevel: "Avancé", length: "Longueur", short: "Courte", medium: "Moyenne", long: "Longue",
    contextPreferences: "Contexte", surroundingLines: "Lignes autour du code", related: "Inclure des extraits liés du projet", relatedCount: "Nombre maximal d'extraits liés", relatedLines: "Lignes par extrait", contextBudget: "Budget de contexte (caractères)",
    cloudPrivacyNote:
      "Les fournisseurs distants reçoivent le code et le contexte envoyés. Un serveur Ollama distant reçoit également ces données.",
    apiKeySecurityNote:
      "Les clés API sont stockées avec SecretStorage et ne sont pas réaffichées.",
    saveSettings: "Enregistrer",
    cancelSettings: "Annuler",
    noDistinctSummary: "Le modele n'a pas fourni de resume distinct.",
    defaultTakeaway: "L'idee principale est deja dans les details ci-dessus.",
    explanationAvailableBelow: "Explication disponible ci-dessous.",
    reviewTakeaway: "Relis surtout le bloc cible et les details pour confirmer ton intuition."
  };
}

function getUiText(language: UiLanguage): Record<string, string> {
  if (language === "fr") {
    return getFrenchUiText();
  }

  if (language === "en") {
    return {
      appName: "XPlanator",
      ready: "Ready",
      analyzing: "Analyzing",
      error: "Error",
      emptySummary: "Select code or place your cursor on a line to get an immediate explanation.",
      emptyDetails:
        "You can launch an explanation from the context menu, the command palette, or the status bar button. Choose OpenAI/Codex, Claude, Gemini, or Ollama in settings.",
      emptyTakeaway: "The goal is simple: understand a piece of code without breaking your reading flow.",
      loadingSummary: "Reading the selected code.",
      loadingTakeaway: "Keep the file context open. The answer will appear here.",
      errorSummary: "I could not generate the explanation.",
      errorTakeaway: "You can retry or check the configured provider connection.",
      sectionDisabled: "This section will not be requested in the next explanation.",
      moreSimple: "Simpler",
      moreDetailed: "More detail",
      retry: "Retry",
      settings: "Settings",
      settingsButton: "Settings",
      generalIdea: "Big picture",
      details: "Fonctionnement",
      takeaway: "Key takeaway",
      hint: "Tip: select only the part that blocks you to get a sharper explanation.",
      loadModels: "Load available models",
      chooseModel: "Available models",
      provider: "Provider",
      model: "Model",
      explanationSections: "Sections to generate",
      ollamaUrl: "Ollama URL",
      openAiBaseUrl: "OpenAI-compatible base URL",
      anthropicBaseUrl: "Anthropic-compatible base URL",
      apiKey: "API key",
      apiKeyPlaceholder: "Leave empty to keep the saved key",
      apiKeyNotNeeded: "not needed for Ollama",
      apiKeyStored: "key already saved",
      apiKeyMissing: "no key saved",
      clearApiKey: "Delete the saved API key for this provider",
      connectionStatus: "Connection status",
      checkConnection: "Check connection",
      testGeneration: "Test generation",
      profileManage: "Switch or manage profiles",
      advanced: "Advanced options",
      timeout: "Timeout (seconds)", explanationPreferences: "Explanation", language: "Language", level: "Learning level",
      beginner: "Beginner", intermediate: "Intermediate", advancedLevel: "Advanced", length: "Length", short: "Short", medium: "Medium", long: "Long",
      contextPreferences: "Context", surroundingLines: "Surrounding lines", related: "Include related workspace snippets", relatedCount: "Maximum related snippets", relatedLines: "Lines per snippet", contextBudget: "Context budget (characters)",
      cloudPrivacyNote: "Ollama keeps requests local. Cloud providers receive the code you ask XPlanator to explain.",
      apiKeySecurityNote: "API keys are never displayed again after saving and are stored with VS Code SecretStorage.",
      saveSettings: "Save",
      cancelSettings: "Cancel",
      noDistinctSummary: "The model did not provide a separate summary.",
      defaultTakeaway: "The main idea is already captured in the details above.",
      explanationAvailableBelow: "Explanation available below.",
      reviewTakeaway: "Re-read the target snippet and the details to confirm your understanding."
    };
  }

  return getFrenchUiText();
}
