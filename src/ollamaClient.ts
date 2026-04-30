import { ExplainRequest, OllamaGenerateResponse, OllamaStatus, OllamaTagsResponse } from "./types";

export class OllamaClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutSeconds: number
  ) {}

  async generate(request: ExplainRequest): Promise<string> {
    const response = await this.requestJson<OllamaGenerateResponse>("/api/generate", {
      method: "POST",
      body: JSON.stringify(request)
    });

    if (!response.response?.trim()) {
      throw new Error("Ollama a renvoye une reponse vide.");
    }

    return response.response.trim();
  }

  async checkConnection(): Promise<OllamaStatus> {
    const response = await this.requestJson<OllamaTagsResponse>("/api/tags", {
      method: "GET"
    });

    const models = response.models?.flatMap((model) => {
      const values = [model.name, model.model].filter((value): value is string => Boolean(value));
      return values;
    }) ?? [];

    return {
      connected: true,
      models: Array.from(new Set(models))
    };
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000);
    const url = `${this.baseUrl.replace(/\/$/, "")}${path}`;

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
      const payload = parseJson<T & { error?: string }>(responseText);

      if (!response.ok) {
        throw new Error(this.mapHttpError(response.status, payload?.error));
      }

      if (payload?.error) {
        throw new Error(this.mapPayloadError(payload.error));
      }

      return payload;
    } catch (error) {
      throw normalizeOllamaError(error);
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private mapHttpError(status: number, errorMessage?: string): string {
    if (errorMessage) {
      return this.mapPayloadError(errorMessage);
    }

    if (status === 404) {
      return "Le modele configure semble absent. Essayez : ollama pull qwen2.5-coder";
    }

    return `Ollama a renvoye une erreur HTTP ${status}.`;
  }

  private mapPayloadError(message: string): string {
    const normalized = message.toLowerCase();

    if (normalized.includes("model") && normalized.includes("not found")) {
      return "Le modele configure semble absent. Essayez : ollama pull qwen2.5-coder";
    }

    return message;
  }
}

function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error("La reponse d'Ollama n'est pas un JSON valide.");
  }
}

function normalizeOllamaError(error: unknown): Error {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new Error("Le modele met trop de temps a repondre. Essayez un modele plus leger ou augmentez le timeout dans les parametres.");
    }

    if (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("fetch failed") ||
      error.message.includes("ENOTFOUND")
    ) {
      return new Error("Impossible de contacter Ollama. Verifiez qu'Ollama est installe et lance.");
    }

    return error;
  }

  return new Error("Impossible de contacter Ollama. Verifiez qu'Ollama est installe et lance.");
}
