import { strict as assert } from "node:assert";
import { test } from "node:test";
import { streamGeneration } from "./aiStream";
import { ExtensionConfig, ModelProvider } from "./types";

const config = { language: "fr", timeoutSeconds: 5, model: "example", openAiBaseUrl: "https://example.com/v1", anthropicBaseUrl: "https://api.anthropic.com/v1", ollamaUrl: "http://localhost:11434" } as ExtensionConfig;

function response(chunks: string[]): Response {
  const bytes = new TextEncoder().encode(chunks.join(""));
  return new Response(new ReadableStream({ start(controller) {
    // Split UTF-8 and protocol boundaries independently of server frames.
    for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
    controller.close();
  } }));
}

const cases: Array<{ provider: ModelProvider; frames: string[] }> = [
  { provider: "ollama", frames: ['{"response":"é","done":false}\n', '{"response":"!","done":true,"done_reason":"stop"}\n'] },
  { provider: "openai", frames: ['data: {"choices":[{"delta":{"content":"é"}}]}\r\n\r\n', 'data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'] },
  { provider: "anthropic", frames: ['event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"é!"}}\n\n', 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n', 'data: {"type":"message_stop"}\n\n'] },
  { provider: "gemini", frames: ['data: {"candidates":[{"content":{"parts":[{"text":"é!"}]},"finishReason":"STOP"}]}\n\n'] }
];

for (const example of cases) test(`streams ${example.provider} with fragmented UTF-8`, async () => {
  const original = globalThis.fetch;
  let options: RequestInit | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => { options = init; return response(example.frames); }) as typeof fetch;
  try {
    let partial = "";
    const result = await streamGeneration({ ...config, provider: example.provider }, "key", {
      prompt: "code", maxTokens: 50, signal: new AbortController().signal, onText: text => { partial += text; }
    });
    assert.equal(result, "é!");
    assert.equal(partial, "é!");
    assert.equal(options?.redirect, "error");
    assert.equal(JSON.parse(String(options?.body)).stream ?? example.provider === "gemini", true);
  } finally { globalThis.fetch = original; }
});

test("rejects incomplete and truncated streams", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (async () => response(['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'])) as typeof fetch;
    const req = { prompt: "x", maxTokens: 5, signal: new AbortController().signal, onText: () => {} };
    await assert.rejects(streamGeneration({ ...config, provider: "openai" }, "key", req), /interrompu/);
    globalThis.fetch = (async () => response(['{"response":"partial","done":true,"done_reason":"length"}\n'])) as typeof fetch;
    await assert.rejects(streamGeneration({ ...config, provider: "ollama" }, undefined, req), /incomplète/);
  } finally { globalThis.fetch = original; }
});

test("abort reaches the transport", async () => {
  const original = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    controller.abort();
  })) as typeof fetch;
  try {
    await assert.rejects(streamGeneration({ ...config, provider: "openai" }, "key", {
      prompt: "x", maxTokens: 5, signal: controller.signal, onText: () => {}
    }), /annulée/);
  } finally { globalThis.fetch = original; }
});

test("captures usage reported by the provider without inventing a price", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response([
    '{"model":"local-model","response":"ok","done":true,"done_reason":"stop","prompt_eval_count":12,"eval_count":4}\n'
  ])) as typeof fetch;
  try {
    let usage: unknown;
    await streamGeneration({ ...config, provider: "ollama" }, undefined, { prompt: "x", maxTokens: 5,
      signal: new AbortController().signal, onText: () => {}, onUsage: value => { usage = value; } });
    assert.deepEqual(usage, { model: "local-model", inputTokens: 12, outputTokens: 4 });
  } finally { globalThis.fetch = original; }
});

test("reports a timeout separately from user cancellation", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  })) as typeof fetch;
  try {
    await assert.rejects(streamGeneration({ ...config, provider: "openai", timeoutSeconds: 1 }, "key", {
      prompt: "x", maxTokens: 5, signal: new AbortController().signal, onText: () => {}
    }), /délai/);
  } finally { globalThis.fetch = original; }
});

test("structured stream is validated before returning an explanation", async () => {
  const original = globalThis.fetch;
  const frame = (text: string) => JSON.stringify({ response: text, done: true, done_reason: "stop" }) + "\n";
  const request = { prompt: "explain", maxTokens: 50, structured: true, signal: new AbortController().signal, onText: () => {} };
  try {
    globalThis.fetch = (async () => response([frame('{"summary":"ok","details":"","takeaway":""}')])) as typeof fetch;
    assert.equal(await streamGeneration({ ...config, provider: "ollama" }, undefined, request), "Résumé:\nok");
    globalThis.fetch = (async () => response([frame('{"summary":"ok"}')])) as typeof fetch;
    await assert.rejects(streamGeneration({ ...config, provider: "ollama" }, undefined, request), /format attendu/);
  } finally { globalThis.fetch = original; }
});
