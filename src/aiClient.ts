import * as vscode from "vscode";
import {
  ExplainRequest,
  ExtensionConfig,
  ModelProvider,
  OllamaGenerateResponse,
  OllamaStatus,
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

  async generate(config: ExtensionConfig, request: ProviderRequest): Promise<string> {
    switch (config.provider) {
      case "openai":
        return this.generateWithOpenAi(config, request);
      case "gemini":
        return this.generateWithGemini(config, request);
      case "anthropic":
        return this.generateWithAnthropic(config, request);
      case "ollama":
      default:
        return this.generateWithOllama(config, request);
    }
  }

  async checkConnection(config: ExtensionConfig): Promise<OllamaStatus> {
    if (config.provider === "ollama") {
      return this.checkOllamaConnection(config);
    }

    await this.generate(config, {
      prompt: "Reply with exactly: ok",
      maxTokens: 16
    });

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
      {
        method: "POST",
        body: JSON.stringify(ollamaRequest)
      }
    );

    if (!response.response?.trim()) {
      throw new Error("Ollama a renvoye une reponse vide.");
    }

    return response.response.trim();
  }

  private async checkOllamaConnection(config: ExtensionConfig): Promise<OllamaStatus> {
    const response = await this.requestJson<OllamaTagsResponse>(
      `${config.ollamaUrl.replace(/\/$/, "")}/api/tags`,
      config.timeoutSeconds,
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

  private async generateWithOpenAi(config: ExtensionConfig, request: ProviderRequest): Promise<string> {
    const apiKey = await this.requireApiKey("openai");
    const response = await this.requestJson<OpenAiResponse>(
      `${config.openAiBaseUrl.replace(/\/$/, "")}/responses`,
      config.timeoutSeconds,
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
      throw new Error("OpenAI/Codex a renvoye une reponse vide.");
    }

    return output.trim();
  }

  private async generateWithGemini(config: ExtensionConfig, request: ProviderRequest): Promise<string> {
    const apiKey = await this.requireApiKey("gemini");
    const response = await this.requestJson<GeminiResponse>(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      config.timeoutSeconds,
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
      throw new Error("Gemini a renvoye une reponse vide.");
    }

    return output.trim();
  }

  private async generateWithAnthropic(config: ExtensionConfig, request: ProviderRequest): Promise<string> {
    const apiKey = await this.requireApiKey("anthropic");
    const response = await this.requestJson<AnthropicResponse>("https://api.anthropic.com/v1/messages", config.timeoutSeconds, {
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
      throw new Error("Claude a renvoye une reponse vide.");
    }

    return output.trim();
  }

  private async requireApiKey(provider: ModelProvider): Promise<string> {
    const apiKey = await this.secrets.get(getSecretKey(provider));

    if (!apiKey?.trim()) {
      throw new Error(`Aucune cle API n'est configuree pour ${getProviderLabel(provider)}.`);
    }

    return apiKey;
  }

  private async requestJson<T>(url: string, timeoutSeconds: number, init: RequestInit): Promise<T> {
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
      const payload = parseJson<T & { error?: string | { message?: string } }>(responseText);

      if (!response.ok) {
        throw new Error(mapHttpError(url, response.status, payload?.error));
      }

      if (payload?.error) {
        throw new Error(mapPayloadError(payload.error));
      }

      return payload;
    } catch (error) {
      throw normalizeProviderError(error);
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

function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("Le fournisseur a renvoye une reponse qui n'est pas un JSON valide.");
  }
}

function mapHttpError(url: string, status: number, error?: string | { message?: string }): string {
  const providerError = mapPayloadError(error);

  if (providerError) {
    return providerError;
  }

  if (url.includes("/api/generate") && status === 404) {
    return "Le modele Ollama configure semble absent. Essayez de le telecharger avec ollama pull.";
  }

  if (status === 401 || status === 403) {
    return "La cle API est absente, invalide ou refusee par le fournisseur.";
  }

  return `Le fournisseur IA a renvoye une erreur HTTP ${status}.`;
}

function mapPayloadError(error?: string | { message?: string }): string {
  if (!error) {
    return "";
  }

  const message = typeof error === "string" ? error : error.message;

  if (!message) {
    return "";
  }

  const normalized = message.toLowerCase();

  if (normalized.includes("model") && normalized.includes("not found")) {
    return "Le modele configure semble absent ou invalide pour ce fournisseur.";
  }

  return message;
}

function normalizeProviderError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new Error("Le modele met trop de temps a repondre. Essayez un modele plus leger ou augmentez le timeout dans les parametres.");
    }

    if (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("fetch failed") ||
      error.message.includes("ENOTFOUND")
    ) {
      return new Error("Impossible de contacter le fournisseur IA. Verifiez la connexion, l'URL ou la cle API.");
    }

    return error;
  }

  return new Error("Impossible de contacter le fournisseur IA.");
}
