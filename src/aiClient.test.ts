import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AiClient } from "./aiClient";
import { ExtensionConfig } from "./types";

const config = { provider: "meta", language: "fr", timeoutSeconds: 5, model: "test", openAiBaseUrl: "https://api.openai.com/v1", anthropicBaseUrl: "https://api.anthropic.com/v1", ollamaUrl: "http://localhost:11434" } as ExtensionConfig;

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
    const client = new AiClient();
    assert.deepEqual(await client.listModels(config, "draft-key"), ["model-a", "model-b"]);
    assert.equal(calls[0].url, "https://api.meta.ai/v1/models");
    assert.equal(calls[0].headers.Authorization, "Bearer draft-key");
    assert.deepEqual(await client.listModels({ ...config, provider: "gemini" }, "saved-key"), ["gemini-a", "gemini-b"]);
    assert.equal(calls[1].headers["x-goog-api-key"], "saved-key");
    assert.deepEqual(await client.listModels({ ...config, provider: "anthropic" }, "saved-key"), ["claude-a", "claude-b"]);
    assert.equal(calls[3].headers["anthropic-version"], "2023-06-01");
    assert.deepEqual(await client.listModels({ ...config, provider: "openai" }, "saved-key"), ["model-a", "model-b"]);
    assert.deepEqual(await client.listModels({ ...config, provider: "ollama" }), ["local"]);
  } finally { globalThis.fetch = original; }
});


test("connection diagnostics only read the catalog and reject redirects", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { ok: true, text: async () => JSON.stringify({ data: [{ id: "test" }] }) } as Response;
  }) as typeof fetch;
  try {
    const result = await new AiClient().checkConnection({ ...config, provider: "openai" }, "saved-key");
    assert.deepEqual(result.models, ["test"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init?.method, "GET");
    assert.equal(calls[0].init?.redirect, "error");
    assert.match(calls[0].url, /\/models$/);
  } finally { globalThis.fetch = original; }
});

test("never falls back to a legacy credential and reports authentication failures", async () => {
  const client = new AiClient();
  const cloud = { ...config, provider: "openai" as const };
  await assert.rejects(client.listModels(cloud), /clé API/);
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;
  try { await assert.rejects(client.listModels(cloud, "key"), /Authentification/); }
  finally { globalThis.fetch = original; }
});
