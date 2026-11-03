import { ExtensionConfig } from "../types";

export interface GenerationUsage { model?: string; inputTokens?: number; outputTokens?: number; reasoningTokens?: number }
export interface GenerationInput { prompt: string; maxTokens: number; structured?: boolean }
export interface PreparedRequest { url: string; headers: Record<string, string>; body: object; framing: "sse" | "ndjson" }
export interface StreamState { complete: boolean; finishReason?: string; usage: GenerationUsage }
export interface ProviderAdapter {
  prepare(config: ExtensionConfig, key: string | undefined, input: GenerationInput): PreparedRequest;
  decode(frame: string, state: StreamState, config: ExtensionConfig): string;
}

export function versionedUrl(base: string, route: string): string {
  const url = new URL(base);
  const path = url.pathname.replace(/\/+$/, "") || "/v1";
  url.pathname = path.endsWith(`/${route}`) ? path : `${path}/${route}`;
  return url.toString();
}

export function parseFrame<T>(frame: string): T {
  try { return JSON.parse(frame) as T; }
  catch { throw new Error("Le fournisseur a renvoyé un flux JSON invalide."); }
}
