import { ExtensionConfig, ModelProvider } from "../types";
import { versionedUrl } from "./contracts";

interface CatalogPayload {
  data?: Array<{ id?: string }>;
  models?: Array<{ name?: string; model?: string; supportedGenerationMethods?: string[] }>;
  nextPageToken?: string;
  has_more?: boolean;
  last_id?: string;
}
interface CatalogPage { models: string[]; next?: string }
interface CatalogAdapter {
  request(config: ExtensionConfig, key: string | undefined, cursor: string): { url: string; headers: Record<string, string> };
  parse(payload: CatalogPayload): CatalogPage;
}
type JsonRequest = <T>(url: string, headers: Record<string, string>) => Promise<T>;

function bearer(base: (config: ExtensionConfig) => string): CatalogAdapter {
  return {
    request: (config, key) => ({ url: versionedUrl(base(config), "models"), headers: { Authorization: `Bearer ${key ?? ""}` } }),
    parse: payload => ({ models: requireArray(payload.data).flatMap(item => item.id ? [item.id] : []) })
  };
}

const adapters: Record<ModelProvider, CatalogAdapter> = {
  openai: bearer(config => config.openAiBaseUrl),
  meta: bearer(() => "https://api.meta.ai/v1"),
  anthropic: {
    request(config, key, cursor) {
      const url = new URL(versionedUrl(config.anthropicBaseUrl, "models"));
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("after_id", cursor);
      return { url: url.toString(), headers: { "x-api-key": key ?? "", "anthropic-version": "2023-06-01" } };
    },
    parse: payload => {
      if (payload.has_more && !payload.last_id) throw new Error("Pagination du catalogue invalide.");
      return { models: requireArray(payload.data).flatMap(item => item.id ? [item.id] : []), next: payload.has_more ? payload.last_id : undefined };
    }
  },
  gemini: {
    request(_config, key, cursor) {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      if (cursor) url.searchParams.set("pageToken", cursor);
      return { url: url.toString(), headers: { "x-goog-api-key": key ?? "" } };
    },
    parse: payload => ({ models: requireArray(payload.models).flatMap(item => item.name && item.supportedGenerationMethods?.includes("generateContent") ? [item.name.replace(/^models\//, "")] : []), next: payload.nextPageToken })
  },
  ollama: {
    request: config => ({ url: `${config.ollamaUrl.replace(/\/$/, "")}/api/tags`, headers: {} }),
    parse: payload => ({ models: requireArray(payload.models).flatMap(item => [item.name, item.model].filter((name): name is string => Boolean(name))) })
  }
};

function requireArray<T>(value: T[] | undefined): T[] {
  if (!Array.isArray(value)) throw new Error("Réponse de catalogue invalide : liste de modèles absente.");
  return value;
}

export async function discoverModels(config: ExtensionConfig, key: string | undefined, getJson: JsonRequest): Promise<string[]> {
  const adapter = adapters[config.provider];
  if (!adapter) throw new Error("Fournisseur inconnu.");
  const models: string[] = [];
  const seen = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 100; page++) {
    const request = adapter.request(config, key, cursor);
    const result = adapter.parse(await getJson<CatalogPayload>(request.url, request.headers));
    models.push(...result.models);
    if (!result.next) return [...new Set(models)].sort((a, b) => a.localeCompare(b));
    if (seen.has(result.next)) throw new Error("Pagination du catalogue invalide.");
    seen.add(result.next);
    cursor = result.next;
  }
  throw new Error("Limite de pagination du catalogue atteinte.");
}
