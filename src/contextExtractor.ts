import * as path from "path";
import * as vscode from "vscode";
import { CodeContext, ExtensionConfig, RelatedSnippet } from "./types";
import { shouldSkipSameFileRelatedRange } from "./contextSnippetProximity";

const MAX_SELECTED_CHARACTERS = 12000;

export async function getCodeContext(
  editor: vscode.TextEditor,
  config: Pick<
    ExtensionConfig,
    | "maxSurroundingLines"
    | "includeRelatedContext"
    | "maxRelatedSnippets"
    | "maxRelatedLinesPerSnippet"
    | "maxContextCharacters"
  >,
  preferSelection: boolean
): Promise<CodeContext> {
  const document = editor.document;
  const selection = editor.selection;
  const hasSelection = preferSelection && !selection.isEmpty;
  const wordRange = document.getWordRangeAtPosition(selection.active);
  const symbolUnderCursor = wordRange ? document.getText(wordRange) : undefined;
  const documentSymbolRange = !hasSelection && !preferSelection
    ? await getDocumentSymbolRange(document, selection.active)
    : undefined;

  let targetRange: vscode.Range;
  let selectedCode: string;

  if (hasSelection) {
    targetRange = new vscode.Range(selection.start, selection.end);
    selectedCode = document.getText(targetRange).trim();
  } else if (documentSymbolRange) {
    targetRange = documentSymbolRange.range;
    selectedCode = document.getText(targetRange).trim();
  } else if (wordRange) {
    targetRange = wordRange;
    selectedCode = document.getText(wordRange).trim();
  } else {
    const line = document.lineAt(selection.active.line);
    targetRange = line.range;
    selectedCode = line.text.trim();
  }

  if (!selectedCode) {
    throw new Error("Aucun code exploitable n'a ete trouve a expliquer sur la position actuelle.");
  }

  if (selectedCode.length > MAX_SELECTED_CHARACTERS) {
    throw new Error("La selection est trop grande pour une explication rapide. Selectionnez un bloc plus petit.");
  }

  const totalContextLines = clampContextLines(config.maxSurroundingLines);
  const targetStartLine = targetRange.start.line;
  const targetEndLine = targetRange.end.line;
  const targetLineCount = Math.max(1, targetEndLine - targetStartLine + 1);
  const extraLines = Math.max(0, totalContextLines - targetLineCount);
  const linesAbove = Math.floor(extraLines / 2);
  const linesBelow = extraLines - linesAbove;
  const contextStartLine = Math.max(0, targetStartLine - linesAbove);
  const contextEndLine = Math.min(document.lineCount - 1, targetEndLine + linesBelow);

  const surroundingCode = buildNumberedSnippet(document, contextStartLine, contextEndLine);
  const relatedSnippets = await collectRelatedSnippets(document, targetRange, config);

  return {
    fileName: path.basename(document.fileName),
    filePath: document.fileName,
    languageId: document.languageId || "plaintext",
    selectedCode,
    surroundingCode,
    relatedSnippets,
    symbolUnderCursor,
    lineNumber: targetStartLine + 1,
    startLine: targetStartLine + 1,
    endLine: targetEndLine + 1,
    hasSelection
  };
}

async function getDocumentSymbolRange(
  document: vscode.TextDocument,
  position: vscode.Position
): Promise<{ name: string; range: vscode.Range } | undefined> {
  let symbols: Array<vscode.DocumentSymbol | vscode.SymbolInformation> | undefined;

  try {
    symbols = await vscode.commands.executeCommand<Array<vscode.DocumentSymbol | vscode.SymbolInformation>>(
      "vscode.executeDocumentSymbolProvider",
      document.uri
    );
  } catch {
    return undefined;
  }

  const candidates: Array<{ name: string; range: vscode.Range; depth: number }> = [];
  const visit = (symbol: vscode.DocumentSymbol | vscode.SymbolInformation, depth: number): void => {
    if ("children" in symbol && "selectionRange" in symbol) {
      if (isExplainableSymbolKind(symbol.kind) && symbol.selectionRange.contains(position)) {
        candidates.push({ name: symbol.name, range: symbol.range, depth });
      }

      for (const child of symbol.children) {
        visit(child, depth + 1);
      }
    } else if (isExplainableSymbolKind(symbol.kind) && symbol.location.range.contains(position)) {
      candidates.push({ name: symbol.name, range: symbol.location.range, depth });
    }
  };

  for (const symbol of symbols ?? []) {
    visit(symbol, 0);
  }

  candidates.sort((left, right) => right.depth - left.depth || rangeLength(left.range) - rangeLength(right.range));
  const match = candidates[0];
  return match ? { name: match.name, range: match.range } : undefined;
}

function isExplainableSymbolKind(kind: vscode.SymbolKind): boolean {
  return [
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Constructor,
    vscode.SymbolKind.Enum,
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Method,
    vscode.SymbolKind.Module,
    vscode.SymbolKind.Struct,
    vscode.SymbolKind.TypeParameter
  ].includes(kind);
}

function rangeLength(range: vscode.Range): number {
  return (range.end.line - range.start.line) * 100000 + range.end.character - range.start.character;
}

function buildNumberedSnippet(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number
): string {
  const lines: string[] = [];

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const line = document.lineAt(lineNumber);
    lines.push(`${lineNumber + 1}: ${line.text}`);
  }

  return lines.join("\n");
}

function clampContextLines(value: number): number {
  if (!Number.isFinite(value)) {
    return 20;
  }

  return Math.min(200, Math.max(10, Math.round(value)));
}

async function collectRelatedSnippets(
  document: vscode.TextDocument,
  targetRange: vscode.Range,
  config: Pick<
    ExtensionConfig,
    "includeRelatedContext" | "maxRelatedSnippets" | "maxRelatedLinesPerSnippet" | "maxContextCharacters"
  >
): Promise<RelatedSnippet[]> {
  if (!config.includeRelatedContext) {
    return [];
  }

  const relatedLocations = await getRelatedLocations(document.uri, targetRange.start);
  if (!relatedLocations.length) {
    return [];
  }

  const maxSnippets = clampNumber(config.maxRelatedSnippets, 0, 8, 0);
  const maxLines = clampNumber(config.maxRelatedLinesPerSnippet, 8, 80, 28);
  const maxCharacters = clampNumber(config.maxContextCharacters, 4000, 120000, 8000);
  const snippets: RelatedSnippet[] = [];
  let consumedCharacters = 0;

  for (const candidate of relatedLocations) {
    if (snippets.length >= maxSnippets) {
      break;
    }

    if (!isSafeWorkspaceUri(candidate.uri)) {
      continue;
    }

    if (candidate.uri.toString() === document.uri.toString()) {
      const shouldSkipSameFile = shouldSkipSameFileRelatedRange(
        targetRange.start.line,
        targetRange.end.line,
        candidate.range.start.line,
        candidate.range.end.line
      );
      if (shouldSkipSameFile) {
        continue;
      }
    }

    try {
      const relatedDocument = await vscode.workspace.openTextDocument(candidate.uri);
      const snippet = createRelatedSnippet(relatedDocument, candidate.range, candidate.reason, maxLines);
      if (!snippet) {
        continue;
      }

      const estimatedSize = snippet.code.length + snippet.filePath.length + snippet.reason.length;
      if (consumedCharacters + estimatedSize > maxCharacters) {
        break;
      }

      snippets.push(snippet);
      consumedCharacters += estimatedSize;
    } catch {
      continue;
    }
  }

  return snippets;
}

async function getRelatedLocations(
  uri: vscode.Uri,
  position: vscode.Position
): Promise<Array<{ uri: vscode.Uri; range: vscode.Range; reason: string }>> {
  const definitionResult = await vscode.commands.executeCommand<
    Array<vscode.Location | vscode.LocationLink> | undefined
  >("vscode.executeDefinitionProvider", uri, position);
  const referenceResult = await vscode.commands.executeCommand<vscode.Location[] | undefined>(
    "vscode.executeReferenceProvider",
    uri,
    position
  );

  const results: Array<{ uri: vscode.Uri; range: vscode.Range; reason: string }> = [];
  const seen = new Set<string>();

  for (const item of definitionResult ?? []) {
    const normalized = normalizeLocation(item);
    if (!normalized) {
      continue;
    }

    const key = `${normalized.uri.toString()}:${normalized.range.start.line}:${normalized.range.start.character}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push({ ...normalized, reason: "definition" });
  }

  for (const location of referenceResult ?? []) {
    const key = `${location.uri.toString()}:${location.range.start.line}:${location.range.start.character}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push({
      uri: location.uri,
      range: location.range,
      reason: "reference"
    });
  }

  return results;
}

function normalizeLocation(
  item: vscode.Location | vscode.LocationLink
): { uri: vscode.Uri; range: vscode.Range } | undefined {
  if (item instanceof vscode.Location) {
    return { uri: item.uri, range: item.range };
  }

  if ("targetUri" in item) {
    return {
      uri: item.targetUri,
      range: item.targetSelectionRange ?? item.targetRange
    };
  }

  return undefined;
}

function createRelatedSnippet(
  document: vscode.TextDocument,
  range: vscode.Range,
  reason: string,
  maxLines: number
): RelatedSnippet | undefined {
  if (document.lineCount === 0) {
    return undefined;
  }

  const centerStart = range.start.line;
  const centerEnd = range.end.line;
  const targetLineCount = Math.max(1, centerEnd - centerStart + 1);
  const remaining = Math.max(0, maxLines - targetLineCount);
  const above = Math.floor(remaining / 2);
  const below = remaining - above;
  const startLine = Math.max(0, centerStart - above);
  const endLine = Math.min(document.lineCount - 1, centerEnd + below);

  return {
    fileName: path.basename(document.fileName),
    filePath: document.fileName,
    languageId: document.languageId || "plaintext",
    startLine: startLine + 1,
    endLine: endLine + 1,
    reason,
    code: buildNumberedSnippet(document, startLine, endLine)
  };
}

function isSafeWorkspaceUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== "file") {
    return false;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  if (!workspaceFolder) {
    return false;
  }

  const relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
  if (!relativePath || relativePath.startsWith("..")) {
    return false;
  }

  const segments = relativePath.split(path.sep);
  return !segments.some((segment) => segment.startsWith(".") || segment === "node_modules");
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
