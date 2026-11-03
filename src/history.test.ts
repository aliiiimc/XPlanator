import { strict as assert } from "node:assert";
import { test } from "node:test";
import { historyAsMarkdown, HistoryRepository } from "./history";
import { CodeContext } from "./types";

const context: CodeContext = { fileName: "demo.ts", filePath: "/work/demo.ts", languageId: "typescript", selectedCode: "return 1", surroundingCode: "return 1", relatedSnippets: [], lineNumber: 1, startLine: 1, endLine: 1, hasSelection: true };
const value = { context, model: "model-a", profileName: "local", mode: "quick" as const, originalExplanation: "one", turns: [] };
function createRepository() {
  const map = new Map<string, unknown>();
  return new HistoryRepository({ get: <T>(key: string) => map.get(key) as T | undefined, update: async (key, item) => { map.set(key, item); } });
}

test("history requires opt-in, limits retention and replaces conversations", async () => {
  const repo = createRepository();
  assert.equal(await repo.save(value, false, 1), undefined);
  const first = await repo.save(value, true, 1);
  assert.ok(first);
  const updated = await repo.save({ ...value, id: first.id, turns: [{ question: "Why?", answer: "Because." }] }, true, 1);
  assert.equal(repo.list().length, 1);
  assert.match(historyAsMarkdown(updated!), /Why\?[\s\S]*Because/);
  const second = await repo.save({ ...value, originalExplanation: "two" }, true, 1);
  assert.equal(repo.list()[0].id, second?.id);
  await repo.remove(second!.id);
  assert.deepEqual(repo.list(), []);
});

test("history skips common credential material and sensitive file names", async () => {
  const repo = createRepository();
  assert.equal(await repo.save({ ...value, context: { ...context, filePath: "/work/.env.local" } }, true, 20), undefined);
  assert.equal(await repo.save({ ...value, context: { ...context, selectedCode: "sk-abcdefghijklmnop123456" } }, true, 20), undefined);
  assert.equal(await repo.save({ ...value, originalExplanation: "ghp_abcdefghijklmnopqrst123456" }, true, 20), undefined);
  assert.equal(repo.list().length, 0);
});
