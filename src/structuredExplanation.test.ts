import { strict as assert } from "node:assert";
import { test } from "node:test";
import { formatStructuredExplanation } from "./structuredExplanation";
import { providers } from "./providers/registry";
import { ExtensionConfig, ModelProvider } from "./types";

test("validates structured explanations and omits empty sections", () => {
  assert.equal(formatStructuredExplanation('{"summary":"hello","details":"","takeaway":"remember"}'), "Résumé:\nhello\n\nÀ retenir:\nremember");
  assert.throws(() => formatStructuredExplanation('{"summary":"hello"}'), /format attendu/);
  assert.throws(() => formatStructuredExplanation('{"summary":"","details":"","takeaway":""}'), /vide/);
  assert.throws(() => formatStructuredExplanation('not json'), /JSON valide/);
});

test("structured output parameters are only sent when explicitly enabled", () => {
  const config = { model: "model", provider: "openai", openAiBaseUrl: "https://api.openai.com/v1", anthropicBaseUrl: "https://api.anthropic.com/v1", ollamaUrl: "http://localhost:11434" } as ExtensionConfig;
  for (const provider of ["openai", "meta", "anthropic", "gemini", "ollama"] as ModelProvider[]) {
    const adapter = providers[provider];
    const normal = JSON.stringify(adapter.prepare({ ...config, provider }, "key", { prompt: "test", maxTokens: 50 }).body);
    const structured = JSON.stringify(adapter.prepare({ ...config, provider }, "key", { prompt: "test", maxTokens: 50, structured: true }).body);
    assert.doesNotMatch(normal, /json_schema|responseJsonSchema|"format"/);
    assert.match(structured, /json_schema|responseJsonSchema|"format"/);
  }
});
