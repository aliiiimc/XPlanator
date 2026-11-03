import { ProviderAdapter, parseFrame } from "./contracts";
import { explanationSchema } from "../structuredExplanation";

export const geminiAdapter: ProviderAdapter = {
  prepare(config, key, input) {
    return { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:streamGenerateContent?alt=sse`, framing: "sse",
      headers: { "x-goog-api-key": key ?? "" },
      body: { contents: [{ role: "user", parts: [{ text: input.prompt }] }], generationConfig: { maxOutputTokens: input.maxTokens,
        ...(input.structured ? { responseMimeType: "application/json", responseJsonSchema: explanationSchema } : {}) } } };
  },
  decode(frame, state) {
    const data = parseFrame<{ error?: unknown; modelVersion?: string; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }; candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> }>(frame);
    if (data.error) throw new Error("Gemini a signalé une erreur pendant la génération.");
    state.usage.model = data.modelVersion ?? state.usage.model;
    state.usage.inputTokens = data.usageMetadata?.promptTokenCount ?? state.usage.inputTokens;
    state.usage.outputTokens = data.usageMetadata?.candidatesTokenCount ?? state.usage.outputTokens;
    state.usage.reasoningTokens = data.usageMetadata?.thoughtsTokenCount ?? state.usage.reasoningTokens;
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason) { state.complete = true; state.finishReason = candidate.finishReason; }
    return candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text ?? "").join("") ?? "";
  }
};
