import { ProviderAdapter, parseFrame, versionedUrl } from "./contracts";
import { explanationSchema } from "../structuredExplanation";

export function openAiAdapter(meta = false): ProviderAdapter {
  return {
    prepare(config, key, input) {
      const base = meta ? "https://api.meta.ai/v1" : config.openAiBaseUrl;
      const hostname = new URL(base).hostname.toLowerCase();
      const freeModel = hostname === "freemodel.dev" || hostname.endsWith(".freemodel.dev");
      const official = meta || hostname === "api.openai.com";
      return { url: versionedUrl(base, "chat/completions"), framing: "sse", headers: { Authorization: `Bearer ${key ?? ""}` },
        body: { model: config.model, stream: true, messages: [{ role: "user", content: input.prompt }],
          ...(official ? { max_completion_tokens: input.maxTokens, stream_options: { include_usage: true } } : { max_tokens: input.maxTokens }),
          ...(input.structured ? { response_format: { type: "json_schema", json_schema: { name: "code_explanation", strict: true, schema: explanationSchema } } } : {}),
          ...(freeModel ? { models: [config.model], provider: { allow_fallbacks: false } } : {}) } };
    },
    decode(frame, state, config) {
      if (frame === "[DONE]") { state.complete = true; return ""; }
      const data = parseFrame<{ error?: unknown; model?: string; choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } }>(frame);
      if (data.error) throw new Error("Le fournisseur a signalé une erreur pendant la génération.");
      const hostname = new URL(config.openAiBaseUrl).hostname.toLowerCase();
      if (!meta && (hostname === "freemodel.dev" || hostname.endsWith(".freemodel.dev")) && data.model && data.model.toLowerCase() !== config.model.trim().toLowerCase()) {
        throw new Error("Le fournisseur a dirigé la requête vers un autre modèle.");
      }
      state.usage.model = data.model ?? state.usage.model;
      state.usage.inputTokens = data.usage?.prompt_tokens ?? state.usage.inputTokens;
      state.usage.outputTokens = data.usage?.completion_tokens ?? state.usage.outputTokens;
      state.usage.reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens ?? state.usage.reasoningTokens;
      const choice = data.choices?.[0];
      if (choice?.finish_reason) state.finishReason = choice.finish_reason;
      return choice?.delta?.content ?? "";
    }
  };
}
