export type ExplanationMode = "quick" | "simple" | "detailed";

export type ModelProvider = "ollama" | "openai" | "gemini" | "anthropic";

export type ResponseStyle = "simple" | "technical" | "beginner";

export type UiLanguage = "fr" | "en";

export interface ExtensionConfig {
  provider: ModelProvider;
  ollamaUrl: string;
  openAiBaseUrl: string;
  model: string;
  maxSurroundingLines: number;
  responseStyle: ResponseStyle;
  language: UiLanguage;
  timeoutSeconds: number;
  includeRelatedContext: boolean;
  maxRelatedSnippets: number;
  maxRelatedLinesPerSnippet: number;
  maxContextCharacters: number;
}

export interface ModelSettingsInput {
  provider: ModelProvider;
  model: string;
  ollamaUrl: string;
  openAiBaseUrl: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface ProviderConnectionStatus {
  kind: "idle" | "success" | "error";
  message: string;
}

export interface RelatedSnippet {
  fileName: string;
  filePath: string;
  languageId: string;
  startLine: number;
  endLine: number;
  reason: string;
  code: string;
}

export interface CodeContext {
  fileName: string;
  filePath: string;
  languageId: string;
  selectedCode: string;
  surroundingCode: string;
  relatedSnippets: RelatedSnippet[];
  symbolUnderCursor?: string;
  lineNumber: number;
  startLine: number;
  endLine: number;
  hasSelection: boolean;
}

export interface PromptInput {
  context: CodeContext;
  responseLanguage: string;
  responseStyle: ResponseStyle;
}

export interface ExplainRequest {
  model: string;
  prompt: string;
  stream: false;
  options: {
    temperature: number;
    num_predict: number;
  };
}

export interface OllamaGenerateResponse {
  response?: string;
  error?: string;
}

export interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
  }>;
}

export interface OllamaStatus {
  connected: boolean;
  models: string[];
}

export interface ExplanationResult {
  mode: ExplanationMode;
  explanation: string;
  codeContext: CodeContext;
}

export interface LastExplanationState {
  codeContext: CodeContext;
  explanation: string;
  mode: ExplanationMode;
}
