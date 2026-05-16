import * as vscode from "vscode";
import {
  ExplainRequest,
  ExtensionConfig,
  getProviderLabel,
  ModelProvider,
  OllamaGenerateResponse,
  OllamaStatus,
  UiLanguage,
  OllamaTagsResponse
} from "./types";

interface ProviderRequest {
  prompt: string;
  maxTokens: number;
}

interface OpenAiChatCompletionsResponse {
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{
        text?: string;
        type?: string;
      }>;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface GeminiModelResponse {
  name?: string;
  displayName?: string;
}

interface GeminiGenerationConfig {
  temperature: number;
  maxOutputTokens: number;
  thinkingConfig?: {
    thinkingBudget: number;
  };
}

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  error?: {
    message?: string;
  };
}

export class AiClient {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async generate(config: ExtensionConfig, request: ProviderRequest, apiKeyOverride?: string): Promise<string> {
    switch (config.provider) {
      case "openai":
        return this.generateWithOpenAi(config, request, apiKeyOverride);
      case "gemini":
        return this.generateWithGemini(config, request, apiKeyOverride);
      case "anthropic":
        return this.generateWithAnthropic(config, request, apiKeyOverride);
      case "ollama":
      default:
        return this.generateWithOllama(config, request);
    }
  }

  async checkConnection(config: ExtensionConfig, apiKeyOverride?: string): Promise<OllamaStatus> {
    if (config.provider === "ollama") {
      return this.checkOllamaConnection(config);
    }

    if (config.provider === "gemini") {
      return this.checkGeminiConnection(config, apiKeyOverride);
    }

    await this.generate(config, {
      prompt: "Reply with exactly: ok",
      maxTokens: 128
    }, apiKeyOverride);

    return {
      connected: true,
      models: [config.model]
    };
  }

  private async checkGeminiConnection(config: ExtensionConfig, apiKeyOverride?: string): Promise<OllamaStatus> {
    const apiKey = await this.requireApiKey("gemini", config.language, apiKeyOverride);
    const response = await this.requestJson<GeminiModelResponse>(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}`,
      config.timeoutSeconds,
      config.language,
      {
        method: "GET",
        headers: {
          "x-goog-api-key": apiKey
        }
      }
    );

    return {
      connected: true,
      models: [response.displayName, response.name, config.model].filter((model): model is string => Boolean(model))
    };
  }

  async hasApiKey(provider: ModelProvider): Promise<boolean> {
    if (provider === "ollama") {
      return true;
    }

    return Boolean(normalizeApiKeyInput(await this.secrets.get(getSecretKey(provider))));
  }

  async saveApiKey(provider: ModelProvider, apiKey?: string, clearExisting = false): Promise<void> {
    if (provider === "ollama") {
      return;
    }

    if (clearExisting) {
      await this.secrets.delete(getSecretKey(provider));
      return;
    }

    const normalized = normalizeApiKeyInput(apiKey);

    if (!normalized) {
      return;
    }

    await this.secrets.store(getSecretKey(provider), normalized);
  }

  private async generateWithOllama(config: ExtensionConfig, request: ProviderRequest): Promise<string> {
    const ollamaRequest: ExplainRequest = {
      model: config.model,
      prompt: request.prompt,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: request.maxTokens
      }
    };

    const response = await this.requestJson<OllamaGenerateResponse>(
      `${config.ollamaUrl.replace(/\/$/, "")}/api/generate`,
      config.timeoutSeconds,
      config.language,
      {
        method: "POST",
        body: JSON.stringify(ollamaRequest)
      }
    );

    if (!response.response?.trim()) {
      throw new Error(localizeAiError(config.language, "empty_response", getProviderLabel("ollama")));
    }

    return response.response.trim();
  }

  private async checkOllamaConnection(config: ExtensionConfig): Promise<OllamaStatus> {
    const response = await this.requestJson<OllamaTagsResponse>(
      `${config.ollamaUrl.replace(/\/$/, "")}/api/tags`,
      config.timeoutSeconds,
      config.language,
      {
        method: "GET"
      }
    );

    const models =
      response.models?.flatMap((model) => {
        const values = [model.name, model.model].filter((value): value is string => Boolean(value));
        return values;
      }) ?? [];

    return {
      connected: true,
      models: Array.from(new Set(models))
    };
  }

  private async generateWithOpenAi(config: ExtensionConfig, request: ProviderRequest, apiKeyOverride?: string): Promise<string> {
    validateFreeModelRequestedModel(config);
    const apiKey = await this.requireApiKey("openai", config.language, apiKeyOverride);
    const response = await this.requestJson<OpenAiChatCompletionsResponse>(
      buildVersionedProviderUrl(config.openAiBaseUrl, "chat/completions", config.language),
      config.timeoutSeconds,
      config.language,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(buildOpenAiChatRequestBody(config, request))
      }
    );
    validateOpenAiRoutedModel(config, response);
    const output = extractOpenAiChatOutput(response);

    if (!output?.trim()) {
      throw new Error(localizeAiError(config.language, "empty_response", getProviderLabel("openai")));
    }

    return output.trim();
  }

  private async generateWithGemini(config: ExtensionConfig, request: ProviderRequest, apiKeyOverride?: string): Promise<string> {
    const apiKey = await this.requireApiKey("gemini", config.language, apiKeyOverride);
    const response = await this.requestJson<GeminiResponse>(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      config.timeoutSeconds,
      config.language,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: request.prompt }]
            }
          ],
          generationConfig: buildGeminiGenerationConfig(config.model, request.maxTokens)
        })
      }
    );
    const output = response.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text)
      .filter((text): text is string => Boolean(text?.trim()))
      .join("\n");
    const finishReasons = response.candidates
      ?.map((candidate) => candidate.finishReason)
      .filter((reason): reason is string => Boolean(reason));

    if (finishReasons?.includes("MAX_TOKENS")) {
      throw new Error(localizeAiError(config.language, "truncated_response", getProviderLabel("gemini")));
    }

    if (!output?.trim()) {
      throw new Error(localizeAiError(config.language, "empty_response", getProviderLabel("gemini")));
    }

    return output.trim();
  }

  private async generateWithAnthropic(config: ExtensionConfig, request: ProviderRequest, apiKeyOverride?: string): Promise<string> {
    const apiKey = await this.requireApiKey("anthropic", config.language, apiKeyOverride);
    const response = await this.requestJson<AnthropicResponse>(
      buildVersionedProviderUrl(config.anthropicBaseUrl, "messages", config.language),
      config.timeoutSeconds,
      config.language,
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: request.maxTokens,
          messages: [
            {
              role: "user",
              content: request.prompt
            }
          ]
        })
      }
    );
    const output = response.content
      ?.map((content) => content.text)
      .filter((text): text is string => Boolean(text?.trim()))
      .join("\n");

    if (!output?.trim()) {
      throw new Error(localizeAiError(config.language, "empty_response", getProviderLabel("anthropic")));
    }

    return output.trim();
  }

  private async requireApiKey(provider: ModelProvider, language: UiLanguage, apiKeyOverride?: string): Promise<string> {
    const apiKey = normalizeApiKeyInput(apiKeyOverride) || normalizeApiKeyInput(await this.secrets.get(getSecretKey(provider)));

    if (!apiKey?.trim()) {
      throw new Error(localizeAiError(language, "missing_api_key", getProviderLabel(provider)));
    }

    return apiKey;
  }

  private async requestJson<T>(url: string, timeoutSeconds: number, language: UiLanguage, init: RequestInit): Promise<T> {
    validateEndpointPolicy(url, language);
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {})
        },
        signal: controller.signal
      });
      const responseText = await response.text();
      const payload = parseJson<T & { error?: string | { message?: string } }>(responseText, language);

      if (!response.ok) {
        throw new Error(mapHttpError(language, url, response.status, payload?.error));
      }

      if (payload?.error) {
        throw new Error(mapPayloadError(language, payload.error));
      }

      return payload;
    } catch (error) {
      throw normalizeProviderError(language, error);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

function buildVersionedProviderUrl(baseUrl: string, route: string, language: UiLanguage): string {
  let parsed: URL;

  try {
    parsed = new URL(baseUrl.trim());
  } catch {
    throw new Error(localizeAiError(language, "invalid_endpoint_url"));
  }

  const basePath = parsed.pathname.replace(/\/+$/, "");
  const normalizedRoute = route.replace(/^\/+/, "");
  const routeSuffix = `/${normalizedRoute}`;

  if (basePath.endsWith(routeSuffix)) {
    return parsed.toString();
  }

  const normalizedBasePath = basePath && basePath !== "/" ? basePath : "/v1";
  parsed.pathname = `${normalizedBasePath}/${normalizedRoute}`.replace(/\/{2,}/g, "/");
  return parsed.toString();
}

function buildOpenAiChatRequestBody(config: ExtensionConfig, request: ProviderRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages: [
      {
        role: "user",
        content: request.prompt
      }
    ],
    temperature: 0.2,
    max_tokens: request.maxTokens
  };

  if (isFreeModelEndpoint(config.openAiBaseUrl)) {
    body.models = [config.model];
    body.provider = {
      allow_fallbacks: false
    };
  }

  return body;
}

function validateFreeModelRequestedModel(config: ExtensionConfig): void {
  if (!isFreeModelEndpoint(config.openAiBaseUrl)) {
    return;
  }

  const blockedModels = new Set(["gpt-5-nano", "gpt-5-mini", "gpt-4o-mini"]);
  const requestedModel = normalizeModelForComparison(config.model);

  if (!blockedModels.has(requestedModel)) {
    return;
  }

  throw new Error(localizeAiError(config.language, "freemodel_model_blocked", config.model));
}

function validateOpenAiRoutedModel(config: ExtensionConfig, response: OpenAiChatCompletionsResponse): void {
  if (!isFreeModelEndpoint(config.openAiBaseUrl) || !response.model) {
    return;
  }

  const requestedModel = normalizeModelForComparison(config.model);
  const routedModel = normalizeModelForComparison(response.model);

  if (requestedModel === routedModel) {
    return;
  }

  throw new Error(localizeAiError(config.language, "routed_model_mismatch", `${config.model} -> ${response.model}`));
}

function isFreeModelEndpoint(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname.toLowerCase().endsWith("freemodel.dev");
  } catch {
    return false;
  }
}

function normalizeModelForComparison(model: string): string {
  return model.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function extractOpenAiChatOutput(response: OpenAiChatCompletionsResponse): string {
  return (
    response.choices
      ?.map((choice) => {
        if (choice.text?.trim()) {
          return choice.text;
        }

        const content = choice.message?.content;

        if (typeof content === "string") {
          return content;
        }

        return content
          ?.map((part) => part.text)
          .filter((text): text is string => Boolean(text?.trim()))
          .join("\n");
      })
      .filter((text): text is string => Boolean(text?.trim()))
      .join("\n") ?? ""
  );
}

function getSecretKey(provider: ModelProvider): string {
  return `xplanator.${provider}.apiKey`;
}

function normalizeApiKeyInput(apiKey: string | undefined): string | undefined {
  const normalized = apiKey?.trim();

  if (!normalized || isMaskedSecretPlaceholder(normalized)) {
    return undefined;
  }

  return normalized;
}

function isMaskedSecretPlaceholder(value: string): boolean {
  return Array.from(value).every((character) => {
    const code = character.charCodeAt(0);
    return character === "*" || character === "." || code === 0x2022;
  });
}

function buildGeminiGenerationConfig(model: string, maxOutputTokens: number): GeminiGenerationConfig {
  const generationConfig: GeminiGenerationConfig = {
    temperature: 0.2,
    maxOutputTokens
  };
  const normalizedModel = model.toLowerCase();

  if (normalizedModel.startsWith("gemini-2.5-flash")) {
    generationConfig.thinkingConfig = {
      thinkingBudget: 0
    };
  }

  return generationConfig;
}

function parseJson<T>(value: string, language: UiLanguage): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(localizeAiError(language, "invalid_json"));
  }
}

function mapHttpError(language: UiLanguage, url: string, status: number, error?: string | { message?: string }): string {
  const providerError = mapPayloadError(language, error);

  if (providerError) {
    return providerError;
  }

  if (url.includes("/api/generate") && status === 404) {
    return localizeAiError(language, "missing_ollama_model");
  }

  if (status === 401 || status === 403) {
    return localizeAiError(language, "invalid_api_key");
  }

  return localizeAiError(language, "http_error", String(status));
}

function mapPayloadError(language: UiLanguage, error?: string | { message?: string }): string {
  if (!error) {
    return "";
  }

  const message = typeof error === "string" ? error : error.message;

  if (!message) {
    return "";
  }

  const normalized = message.toLowerCase();

  if (normalized.includes("model") && normalized.includes("not found")) {
    return localizeAiError(language, "missing_model");
  }

  return message;
}

function normalizeProviderError(language: UiLanguage, error: unknown): Error {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new Error(localizeAiError(language, "timeout"));
    }

    if (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("fetch failed") ||
      error.message.includes("ENOTFOUND")
    ) {
      return new Error(localizeAiError(language, "provider_unreachable"));
    }

    return error;
  }

  return new Error(localizeAiError(language, "provider_unreachable"));
}

type AiErrorKey =
  | "empty_response"
  | "missing_api_key"
  | "invalid_json"
  | "invalid_endpoint_url"
  | "invalid_endpoint_protocol"
  | "endpoint_https_required"
  | "missing_ollama_model"
  | "invalid_api_key"
  | "http_error"
  | "missing_model"
  | "truncated_response"
  | "timeout"
  | "provider_unreachable"
  | "routed_model_mismatch"
  | "freemodel_model_blocked";

function localizeAiError(language: UiLanguage, key: AiErrorKey, detail?: string): string {
  const messages: Record<UiLanguage, Record<AiErrorKey, string>> = {
    fr: {
      empty_response: "{detail} a renvoye une reponse vide.",
      missing_api_key: "Aucune cle API n'est configuree pour {detail}.",
      invalid_json: "Le fournisseur a renvoye une reponse qui n'est pas un JSON valide.",
      invalid_endpoint_url: "L'URL du fournisseur configuree est invalide.",
      invalid_endpoint_protocol: "L'URL du fournisseur doit utiliser http:// ou https://.",
      endpoint_https_required: "Les URL de fournisseur non locales doivent utiliser HTTPS.",
      missing_ollama_model: "Le modele Ollama configure semble absent. Essayez de le telecharger avec ollama pull.",
      invalid_api_key: "La cle API est absente, invalide ou refusee par le fournisseur.",
      http_error: "Le fournisseur IA a renvoye une erreur HTTP {detail}.",
      missing_model: "Le modele configure semble absent ou invalide pour ce fournisseur.",
      truncated_response: "{detail} a coupe sa reponse avant la fin. Essayez de relancer ou d'utiliser un modele plus fort.",
      timeout: "Le modele met trop de temps a repondre. Essayez un modele plus leger ou augmentez le timeout dans les parametres.",
      provider_unreachable: "Impossible de contacter le fournisseur IA. Verifiez la connexion, l'URL ou la cle API.",
      routed_model_mismatch: "Le fournisseur a route la requete vers un autre modele ({detail}). Choisissez un nom de modele que FreeModel execute exactement, ou utilisez un autre endpoint.",
      freemodel_model_blocked: "FreeModel route {detail} vers gpt-5.4 dans vos logs. La requete est bloquee pour eviter un cout surprise. Choisissez un modele affiche comme moins cher dans FreeModel."
    },
    en: {
      empty_response: "{detail} returned an empty response.",
      missing_api_key: "No API key is configured for {detail}.",
      invalid_json: "The provider returned a response that is not valid JSON.",
      invalid_endpoint_url: "The configured provider URL is invalid.",
      invalid_endpoint_protocol: "The provider URL must use http:// or https://.",
      endpoint_https_required: "Non-local provider URLs must use HTTPS.",
      missing_ollama_model: "The configured Ollama model seems missing. Try downloading it with ollama pull.",
      invalid_api_key: "The API key is missing, invalid, or rejected by the provider.",
      http_error: "The AI provider returned HTTP error {detail}.",
      missing_model: "The configured model seems missing or invalid for this provider.",
      truncated_response: "{detail} stopped before finishing its answer. Try again or use a stronger model.",
      timeout: "The model is taking too long to respond. Try a lighter model or increase the timeout in settings.",
      provider_unreachable: "Unable to reach the AI provider. Check the connection, URL, or API key.",
      routed_model_mismatch: "The provider routed the request to another model ({detail}). Choose a model name FreeModel runs exactly, or use another endpoint.",
      freemodel_model_blocked: "FreeModel routes {detail} to gpt-5.4 in your logs. The request is blocked to avoid surprise cost. Choose a model shown as cheaper in FreeModel."
    }
  };

  const template = messages[language][key] ?? messages.en[key];

  if (!detail) {
    return template;
  }

  return template.replace("{detail}", detail);
}

function validateEndpointPolicy(url: string, language: UiLanguage): void {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(localizeAiError(language, "invalid_endpoint_url"));
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(localizeAiError(language, "invalid_endpoint_protocol"));
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0";

  if (!isLocalHost && parsed.protocol !== "https:") {
    throw new Error(localizeAiError(language, "endpoint_https_required"));
  }
}
