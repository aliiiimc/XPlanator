import { ExtensionConfig } from "./types";
import { readStreamFrames } from "./streamDecoder";
import { GenerationUsage, StreamState } from "./providers/contracts";
import { providers } from "./providers/registry";
import { describeHttpError } from "./providerErrors";
import { formatStructuredExplanation } from "./structuredExplanation";
export type { GenerationUsage } from "./providers/contracts";

export interface StreamRequest {
  prompt: string;
  maxTokens: number;
  signal: AbortSignal;
  onText: (text: string) => void;
  onUsage?: (usage: GenerationUsage) => void;
  structured?: boolean;
}

/** Provider-specific wire formats are implemented by independent adapters. */
export async function streamGeneration(config: ExtensionConfig, key: string | undefined, request: StreamRequest): Promise<string> {
  const adapter = providers[config.provider];
  if (!adapter) throw new Error("Fournisseur inconnu.");
  const prepared = adapter.prepare(config, key, request);
  validateEndpoint(prepared.url);
  const controller = new AbortController();
  const abort = (): void => controller.abort();
  if (request.signal.aborted) controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), Math.max(1, config.timeoutSeconds) * 1000);
  try {
    const response = await fetch(prepared.url, { method: "POST", headers: { "Content-Type": "application/json", ...prepared.headers },
      body: JSON.stringify(prepared.body), redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(await describeHttpError(response, config.language));
    if (!response.body) throw new Error("Le fournisseur n'a pas renvoyé de flux lisible.");
    let output = "";
    const state: StreamState = { complete: false, usage: {} };
    await readStreamFrames(response.body, prepared.framing, frame => {
      const text = adapter.decode(frame, state, config);
      if (text) {
        if (output.length + text.length > 1_000_000) throw new Error("La réponse dépasse la limite de taille.");
        output += text;
        request.onText(text);
      }
    });
    if (!state.complete) throw new Error("Le flux s'est interrompu avant la fin de la réponse.");
    if (!state.finishReason) throw new Error("Le fournisseur n'a pas confirmé la fin de la réponse.");
    if (state.finishReason && !["stop", "end_turn", "stop_sequence", "STOP"].includes(state.finishReason)) {
      throw new Error("La réponse est incomplète ou refusée par le fournisseur.");
    }
    if (!output.trim()) throw new Error("Le fournisseur a renvoyé une réponse vide.");
    request.onUsage?.(state.usage);
    return request.structured ? formatStructuredExplanation(output) : output.trim();
  } catch (error) {
    if (request.signal.aborted) throw new Error("Génération annulée.");
    if (controller.signal.aborted) throw new Error("Le délai de génération est dépassé.");
    if (error instanceof TypeError && error.message.includes("fetch")) throw new Error("Impossible de contacter le fournisseur. Vérifiez l'adresse et la connexion.");
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
}

function validateEndpoint(value: string): void {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
  if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
    throw new Error("L'URL doit utiliser HTTPS, sauf pour un serveur local.");
  }
}
