import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildFollowUpPrompt } from "./conversation";
import { CodeContext } from "./types";

const context = { fileName: "demo.ts", languageId: "typescript", selectedCode: "return x", surroundingCode: "return x" } as CodeContext;
test("follow-up includes the code, previous explanation and recent exchanges", () => {
  const prompt = buildFollowUpPrompt(context, "original", [{ question: "why?", answer: "because" }], "what if?", "en", "beginner");
  for (const value of ["return x", "original", "why?", "because", "what if?"]) assert.ok(prompt.includes(value));
  assert.match(prompt, /untrusted data/);
});
test("conversation budget drops older turns and bounds the prior explanation", () => {
  const prompt = buildFollowUpPrompt(context, "x".repeat(30000), [{ question: "old", answer: "a".repeat(14000) }], "next", "fr", "simple");
  assert.ok(prompt.length < 15000);
  assert.ok(!prompt.includes("old"));
  assert.throws(() => buildFollowUpPrompt(context, "", [], " ", "fr", "simple"));
});
