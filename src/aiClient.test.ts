import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AiClient } from "./aiClient";
import { ExtensionConfig } from "./types";
import * as vscode from "vscode";

const config = { provider: "meta", language: "fr", timeoutSeconds: 5, model: "test", openAiBaseUrl: "https://api.openai.com/v1", anthropicBaseUrl: "https://api.anthropic.com/v1", ollamaUrl: "http://localhost:11434" } as ExtensionConfig;
const secrets = { get: async () => "saved-key" } as unknown as vscode.SecretStorage;

test("model catalogs use the correct provider credentials and support pagination", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    calls.push({ url: address, headers: init?.headers as Record<string, string> });
    let body: object;
    if (address.includes("generativelanguage")) {
      body = address.includes("pageToken=") ? { models: [{ name: "models/gemini-b", supportedGenerationMethods: ["generateContent"] }] } : { models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }], nextPageToken: "next" };
    } else if (address.includes("anthropic")) {
      body = address.includes("after_id=") ? { data: [{ id: "claude-b" }], has_more: false } : { data: [{ id: "claude-a" }], has_more: true, last_id: "claude-a" };
    } else if (address.includes("11434")) body = { models: [{ name: "local" }] };
    else body = { data: [{ id: "model-b" }, { id: "model-a" }] };
    return { ok: true, text: async () => JSON.stringify(body) } as Response;
  }) as typeof fetch;
  try {
    const client = new AiClient(secrets);
    assert.deepEqual(await client.listModels(config, "draft-key"), ["model-a", "model-b"]);
    assert.equal(calls[0].url, "https://api.meta.ai/v1/models");
    assert.equal(calls[0].headers.Authorization, "Bearer draft-key");
    assert.deepEqual(await client.listModels({ ...config, provider: "gemini" }), ["gemini-a", "gemini-b"]);
    assert.equal(calls[1].headers["x-goog-api-key"], "saved-key");
    assert.deepEqual(await client.listModels({ ...config, provider: "anthropic" }), ["claude-a", "claude-b"]);
    assert.equal(calls[3].headers["anthropic-version"], "2023-06-01");
    assert.deepEqual(await client.listModels({ ...config, provider: "openai" }), ["model-a", "model-b"]);
    assert.deepEqual(await client.listModels({ ...config, provider: "ollama" }), ["local"]);
  } finally { globalThis.fetch = original; }
});
