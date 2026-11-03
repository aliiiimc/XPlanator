import { streamGeneration, StreamRequest } from "./aiStream";
import { describeHttpError } from "./providerErrors";
import { discoverModels } from "./providers/catalog";
import { ExtensionConfig, getProviderLabel, OllamaStatus } from "./types";

/** Coordinates discovery and generation without keeping credentials in process state. */
export class AiClient {
  async generateStream(config: ExtensionConfig, request: StreamRequest, apiKey?: string): Promise<string> {
    this.requireKey(config, apiKey);
    return streamGeneration(config, apiKey, request);
  }

  async checkConnection(config: ExtensionConfig, apiKey?: string): Promise<OllamaStatus> {
    return { connected: true, models: await this.listModels(config, apiKey) };
  }

  async listModels(config: ExtensionConfig, apiKey?: string): Promise<string[]> {
    this.requireKey(config, apiKey);
    return discoverModels(config, apiKey, async <T>(url: string, headers: Record<string, string>): Promise<T> => {
      validateEndpoint(url);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, config.timeoutSeconds) * 1000);
      try {
        const response = await fetch(url, { method: "GET", headers, redirect: "error", signal: controller.signal });
        if (!response.ok) throw new Error(await describeHttpError(response, config.language));
        let payload: T & { error?: unknown };
        try { payload = JSON.parse(await response.text()) as T & { error?: unknown }; }
        catch { throw new Error(config.language === "fr" ? "Le catalogue renvoyé n'est pas un JSON valide." : "The catalog response is not valid JSON."); }
        if (payload?.error) throw new Error(config.language === "fr" ? "Le fournisseur a signalé une erreur dans son catalogue." : "The provider reported a catalog error.");
        return payload;
      } catch (error) {
        if (controller.signal.aborted) throw new Error(config.language === "fr" ? "Le délai de connexion est dépassé." : "The connection timed out.");
        if (error instanceof TypeError && error.message.includes("fetch")) throw new Error(config.language === "fr" ? "Impossible de contacter le fournisseur." : "Unable to contact the provider.");
        throw error;
      } finally { clearTimeout(timer); }
    });
  }

  private requireKey(config: ExtensionConfig, apiKey: string | undefined): void {
    if (config.provider !== "ollama" && (!apiKey?.trim() || /^[*.•]+$/.test(apiKey.trim()))) {
      throw new Error(config.language === "fr" ? `Aucune clé API enregistrée pour ${getProviderLabel(config.provider)}.` : `No API key is configured for ${getProviderLabel(config.provider)}.`);
    }
  }
}

function validateEndpoint(value: string): void {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new Error("L'URL doit utiliser HTTPS, sauf pour un serveur local.");
  }
}
