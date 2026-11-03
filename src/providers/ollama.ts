import { ProviderAdapter, parseFrame } from "./contracts";
import { explanationSchema } from "../structuredExplanation";

export const ollamaAdapter: ProviderAdapter = {
  prepare(config, _key, input) {
    return { url: `${config.ollamaUrl.replace(/\/$/, "")}/api/generate`, framing: "ndjson",
      headers: {}, body: { model: config.model, prompt: input.prompt, stream: true, options: { num_predict: input.maxTokens }, ...(input.structured ? { format: explanationSchema } : {}) } };
  },
  decode(frame, state) {
    const data = parseFrame<{ error?: unknown; model?: string; response?: string; done?: boolean; done_reason?: string; prompt_eval_count?: number; eval_count?: number }>(frame);
    if (data.error) throw new Error("Ollama a signalé une erreur pendant la génération.");
    state.usage.model = data.model ?? state.usage.model;
    state.usage.inputTokens = data.prompt_eval_count ?? state.usage.inputTokens;
    state.usage.outputTokens = data.eval_count ?? state.usage.outputTokens;
    if (data.done) { state.complete = true; state.finishReason = data.done_reason; }
    return data.response ?? "";
  }
};
