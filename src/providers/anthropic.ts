import { ProviderAdapter, parseFrame, versionedUrl } from "./contracts";
import { explanationSchema } from "../structuredExplanation";

export const anthropicAdapter: ProviderAdapter = {
  prepare(config, key, input) {
    return { url: versionedUrl(config.anthropicBaseUrl, "messages"), framing: "sse",
      headers: { "x-api-key": key ?? "", "anthropic-version": "2023-06-01" },
      body: { model: config.model, max_tokens: input.maxTokens, stream: true, messages: [{ role: "user", content: input.prompt }],
        ...(input.structured ? { output_config: { format: { type: "json_schema", schema: explanationSchema } } } : {}) } };
  },
  decode(frame, state) {
    const data = parseFrame<{ type?: string; error?: unknown; delta?: { type?: string; text?: string; stop_reason?: string }; message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }; usage?: { input_tokens?: number; output_tokens?: number } }>(frame);
    if (data.error || data.type === "error") throw new Error("Anthropic a signalé une erreur pendant la génération.");
    state.usage.model = data.message?.model ?? state.usage.model;
    state.usage.inputTokens = data.message?.usage?.input_tokens ?? data.usage?.input_tokens ?? state.usage.inputTokens;
    state.usage.outputTokens = data.usage?.output_tokens ?? data.message?.usage?.output_tokens ?? state.usage.outputTokens;
    if (data.type === "message_delta") state.finishReason = data.delta?.stop_reason;
    if (data.type === "message_stop") state.complete = true;
    return data.type === "content_block_delta" && data.delta?.type === "text_delta" ? data.delta.text ?? "" : "";
  }
};
