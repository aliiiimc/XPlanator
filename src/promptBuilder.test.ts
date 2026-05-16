import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "./promptBuilder";
import { CodeContext } from "./types";

function createContext(overrides: Partial<CodeContext> = {}): CodeContext {
  return {
    fileName: "example.ts",
    filePath: "/tmp/example.ts",
    languageId: "typescript",
    selectedCode: "const total = a + b;",
    surroundingCode: "function sum(a, b) {\n  const total = a + b;\n  return total;\n}",
    relatedSnippets: [],
    symbolUnderCursor: "sum",
    lineNumber: 2,
    startLine: 2,
    endLine: 2,
    hasSelection: true,
    ...overrides
  };
}

test("buildPrompt uses English response format labels for en language", () => {
  const prompt = buildPrompt(
    {
      context: createContext(),
      responseLanguage: "en",
      responseStyle: "beginner",
      explanationSections: ["summary", "details", "takeaway"]
    },
    "quick"
  );

  assert.match(prompt, /Summary:/);
  assert.match(prompt, /Details:/);
  assert.match(prompt, /Key takeaway:/);
});

test("buildPrompt adds simplified-mode instructions", () => {
  const prompt = buildPrompt(
    {
      context: createContext(),
      responseLanguage: "fr",
      responseStyle: "simple",
      explanationSections: ["summary", "details", "takeaway"]
    },
    "simple"
  );

  assert.match(prompt, /Instruction supplementaire/);
  assert.match(prompt, /debutant complet/);
  assert.match(prompt, /Reponse courte\./);
});

test("buildPrompt includes related snippets block when provided", () => {
  const prompt = buildPrompt(
    {
      context: createContext({
        relatedSnippets: [
          {
            fileName: "math.ts",
            filePath: "/tmp/math.ts",
            languageId: "typescript",
            startLine: 10,
            endLine: 15,
            reason: "definition",
            code: "export function add(a, b) { return a + b; }"
          }
        ]
      }),
      responseLanguage: "fr",
      responseStyle: "technical",
      explanationSections: ["summary", "details", "takeaway"]
    },
    "detailed"
  );

  assert.match(prompt, /Contexte lie dans le workspace/);
  assert.match(prompt, /Extrait 1/);
  assert.match(prompt, /math\.ts/);
  assert.match(prompt, /10-15/);
});

test("buildPrompt only asks for selected sections", () => {
  const prompt = buildPrompt(
    {
      context: createContext(),
      responseLanguage: "en",
      responseStyle: "beginner",
      explanationSections: ["details"]
    },
    "quick"
  );

  assert.doesNotMatch(prompt, /Summary:/);
  assert.match(prompt, /Details:/);
  assert.doesNotMatch(prompt, /Key takeaway:/);
  assert.match(prompt, /Do not add omitted sections/);
});
