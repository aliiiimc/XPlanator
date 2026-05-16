import test from "node:test";
import assert from "node:assert/strict";
import { parseExplanation } from "./explanationParser";
import { explainWithLite } from "./liteExplainer";
import { CodeContext } from "./types";

function createContext(overrides: Partial<CodeContext> = {}): CodeContext {
  return {
    fileName: "example.ts",
    filePath: "/tmp/example.ts",
    languageId: "typescript",
    selectedCode: "const total = a + b;",
    surroundingCode: "const total = a + b;",
    relatedSnippets: [],
    symbolUnderCursor: "total",
    lineNumber: 1,
    startLine: 1,
    endLine: 1,
    hasSelection: true,
    ...overrides
  };
}

test("explainWithLite explains a function with params and return", () => {
  const explanation = explainWithLite(
    createContext({
      selectedCode: "function sum(a: number, b: number) {\n  return a + b;\n}",
      symbolUnderCursor: "sum"
    }),
    "quick",
    "en"
  );
  const sections = parseExplanation(explanation, "en");

  assert.match(sections.summary, /function or method/);
  assert.match(sections.summary, /\[\[sum\]\]/);
  assert.match(sections.details, /Inputs it mentions: \[\[a\]\], \[\[b\]\]/);
  assert.match(sections.details, /Visible output: `a \+ b`/);
});

test("explainWithLite detects async API calls and risks in detailed mode", () => {
  const explanation = explainWithLite(
    createContext({
      selectedCode: "async function getUser(id: string) {\n  const res = await fetch(`/api/users/${id}`);\n  return res.json();\n}"
    }),
    "detailed",
    "en"
  );
  const sections = parseExplanation(explanation, "en");

  assert.match(sections.details, /Async behavior:/);
  assert.match(sections.details, /Possible side effects: network request/);
  assert.match(sections.details, /Visible risks to review: no visible error handling/);
});

test("explainWithLite detects conditionals", () => {
  const explanation = explainWithLite(
    createContext({
      selectedCode: "if (score > 10) {\n  return 'win';\n} else {\n  return 'try again';\n}"
    }),
    "quick",
    "en"
  );
  const sections = parseExplanation(explanation, "en");

  assert.match(sections.summary, /decision block|chooses between paths/);
  assert.match(sections.details, /Decision logic:/);
});

test("explainWithLite detects loops and data transformations", () => {
  const explanation = explainWithLite(
    createContext({
      selectedCode: "const names = users.filter(user => user.active).map(user => user.name);"
    }),
    "quick",
    "en"
  );
  const sections = parseExplanation(explanation, "en");

  assert.match(sections.details, /Repeated work or data transformation:/);
  assert.match(sections.details, /filter/);
  assert.match(sections.details, /map/);
});

test("explainWithLite detects class or type definitions", () => {
  const explanation = explainWithLite(
    createContext({
      selectedCode: "interface User {\n  id: string;\n  name: string;\n}"
    }),
    "quick",
    "en"
  );
  const sections = parseExplanation(explanation, "en");

  assert.match(sections.summary, /type or class definition/);
  assert.match(sections.summary, /\[\[User\]\]/);
});

test("explainWithLite detects imports and exports", () => {
  const explanation = explainWithLite(
    createContext({
      selectedCode: "import { readFile } from 'node:fs/promises';\nexport { readFile };"
    }),
    "quick",
    "en"
  );
  const sections = parseExplanation(explanation, "en");

  assert.match(sections.summary, /import or export block/);
});

test("explainWithLite detects assignments", () => {
  const explanation = explainWithLite(
    createContext({
      selectedCode: "let count = 0;\ncount += 1;"
    }),
    "quick",
    "en"
  );
  const sections = parseExplanation(explanation, "en");

  assert.match(sections.summary, /value assignment/);
  assert.match(sections.details, /Values it creates or changes: \[\[count\]\]/);
});

test("explainWithLite has an unknown fallback", () => {
  const explanation = explainWithLite(
    createContext({
      selectedCode: "hello world",
      languageId: "plaintext"
    }),
    "quick",
    "en"
  );
  const sections = parseExplanation(explanation, "en");

  assert.match(sections.summary, /limited confidence|code block/);
  assert.match(sections.details, /could not identify a strong code shape/);
});

test("explainWithLite emits French labels that parser can read", () => {
  const explanation = explainWithLite(
    createContext({
      selectedCode: "def saluer(nom):\n    return nom"
    }),
    "quick",
    "fr"
  );
  const sections = parseExplanation(explanation, "fr");

  assert.match(explanation, /^Resume:/);
  assert.match(explanation, /\nA retenir:/);
  assert.match(sections.summary, /fonction ou methode/);
});

test("simple mode is shorter than detailed mode", () => {
  const context = createContext({
    selectedCode: "async function saveUser(user: User) {\n  await fetch('/api/users', { method: 'POST', body: JSON.stringify(user) });\n  return user.id;\n}"
  });
  const simple = parseExplanation(explainWithLite(context, "simple", "en"), "en");
  const detailed = parseExplanation(explainWithLite(context, "detailed", "en"), "en");

  assert.ok(simple.details.length < detailed.details.length);
  assert.match(detailed.details, /Visible risks to review/);
});
