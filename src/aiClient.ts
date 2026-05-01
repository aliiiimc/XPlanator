import * as vscode from "vscode";
import {
  ExplainRequest,
  ExtensionConfig,
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

interface OpenAiResponse {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
}

interface GeminiResponse {
  candidates?: Array<{
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

    await this.generate(config, {
      prompt: "Reply with exactly: ok",
      maxTokens: 16
    }, apiKeyOverride);

    return {
      connected: true,
      models: [config.model]
    };
  }

  async hasApiKey(provider: ModelProvider): Promise<boolean> {
    if (provider === "ollama") {
      return true;
    }

    return Boolean(await this.secrets.get(getSecretKey(provider)));
  }

  async saveApiKey(provider: ModelProvider, apiKey?: string, clearExisting = false): Promise<void> {
    if (provider === "ollama") {
      return;
    }

    if (clearExisting) {
      await this.secrets.delete(getSecretKey(provider));
      return;
    }

    const normalized = apiKey?.trim();

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
    const apiKey = await this.requireApiKey("openai", config.language, apiKeyOverride);
    const response = await this.requestJson<OpenAiResponse>(
      `${config.openAiBaseUrl.replace(/\/$/, "")}/responses`,
      config.timeoutSeconds,
      config.language,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          input: request.prompt,
          max_output_tokens: request.maxTokens
        })
      }
    );
    const output =
      response.output_text ??
      response.output
        ?.flatMap((item) => item.content ?? [])
        .map((content) => content.text)
        .filter((text): text is string => Boolean(text?.trim()))
        .join("\n");

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
          generationConfig: {
            maxOutputTokens: request.maxTokens
          }
        })
      }
    );
    const output = response.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .map((part) => part.text)
      .filter((text): text is string => Boolean(text?.trim()))
      .join("\n");

    if (!output?.trim()) {
      throw new Error(localizeAiError(config.language, "empty_response", getProviderLabel("gemini")));
    }

    return output.trim();
  }

  private async generateWithAnthropic(config: ExtensionConfig, request: ProviderRequest, apiKeyOverride?: string): Promise<string> {
    const apiKey = await this.requireApiKey("anthropic", config.language, apiKeyOverride);
    const response = await this.requestJson<AnthropicResponse>("https://api.anthropic.com/v1/messages", config.timeoutSeconds, config.language, {
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
    });
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
    const apiKey = apiKeyOverride?.trim() || (await this.secrets.get(getSecretKey(provider)));

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

function getSecretKey(provider: ModelProvider): string {
  return `xplanator.${provider}.apiKey`;
}

function getProviderLabel(provider: ModelProvider): string {
  switch (provider) {
    case "openai":
      return "OpenAI/Codex";
    case "gemini":
      return "Gemini";
    case "anthropic":
      return "Claude";
    case "ollama":
    default:
      return "Ollama";
  }
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
  | "timeout"
  | "provider_unreachable";

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
      timeout: "Le modele met trop de temps a repondre. Essayez un modele plus leger ou augmentez le timeout dans les parametres.",
      provider_unreachable: "Impossible de contacter le fournisseur IA. Verifiez la connexion, l'URL ou la cle API."
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
      timeout: "The model is taking too long to respond. Try a lighter model or increase the timeout in settings.",
      provider_unreachable: "Unable to reach the AI provider. Check the connection, URL, or API key."
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
