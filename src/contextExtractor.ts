import * as path from "path";
import { realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as vscode from "vscode";
import { CodeContext, ExtensionConfig, RelatedSnippet } from "./types";
import { shouldSkipSameFileRelatedRange } from "./contextSnippetProximity";
import { findEnclosingSymbol } from "./symbolSelection";

const MAX_SELECTED_CHARACTERS = 12000;
export type ContextMode = "auto" | "selection" | "line" | "function" | "class" | "file";

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
  preferSelection: boolean,
  mode: ContextMode = "auto"
): Promise<CodeContext> {
  const document = editor.document;
  const version = document.version;
  const selection = editor.selection;
  const hasSelection = (mode === "selection" || (mode === "auto" && preferSelection)) && !selection.isEmpty;
  const wordRange = document.getWordRangeAtPosition(selection.active);
  const symbolUnderCursor = wordRange ? document.getText(wordRange) : undefined;
  if (mode === "selection" && !hasSelection) throw new Error("Sélectionnez du code avant de choisir ce mode.");
  const documentSymbolRange = !hasSelection && (mode === "auto" || mode === "function" || mode === "class")
    ? await getDocumentSymbolRange(document, selection.active, mode)
    : undefined;

  let targetRange: vscode.Range;
  let selectedCode: string;

  if (hasSelection) {
    targetRange = new vscode.Range(selection.start, selection.end);
  } else if (mode === "file") {
    targetRange = new vscode.Range(document.lineAt(0).range.start, document.lineAt(document.lineCount - 1).range.end);
  } else if (documentSymbolRange) {
    targetRange = documentSymbolRange.range;
  } else if (mode === "function" || mode === "class") {
    throw new Error(mode === "function" ? "Aucune fonction ou méthode n'a été détectée à cette position." : "Aucune classe n'a été détectée à cette position.");
  } else {
    const line = document.lineAt(selection.active.line);
    targetRange = line.range;
  }

  if (document.offsetAt(targetRange.end) - document.offsetAt(targetRange.start) > MAX_SELECTED_CHARACTERS) {
    throw new Error("Le code cible est trop volumineux. Sélectionnez un bloc plus petit.");
  }
  selectedCode = document.getText(targetRange).trim();

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

  const budget = clampNumber(config.maxContextCharacters, 4000, 120000, 8000);
  if (selectedCode.length > budget) throw new Error("Le code cible dépasse le budget de contexte. Augmentez la limite ou réduisez la sélection.");
  const remaining = budget - selectedCode.length;
  const surroundingBudget = config.includeRelatedContext && config.maxRelatedSnippets > 0 ? Math.floor(remaining * 0.6) : remaining;
  const surroundingCode = surroundingBudget > 32 ? buildNumberedSnippet(document, contextStartLine, contextEndLine, surroundingBudget - 24) : "";
  const documentEnd = document.lineAt(document.lineCount - 1).range.end;
  const sourceHash = document.offsetAt(documentEnd) <= 1_000_000
    ? createHash("sha256").update(document.getText()).digest("hex") : undefined;
  const relatedSnippets = await collectRelatedSnippets(document, targetRange, config, Math.max(0, remaining - surroundingCode.length));
  if (document.version !== version) throw new Error("Le fichier a changé pendant la collecte du contexte. Réessayez.");

  return {
    fileName: path.basename(document.fileName),
    filePath: document.fileName,
    languageId: document.languageId || "plaintext",
    selectedCode,
    surroundingCode,
    relatedSnippets,
    symbolUnderCursor: documentSymbolRange?.name ?? symbolUnderCursor,
    lineNumber: targetStartLine + 1,
    startLine: targetStartLine + 1,
    endLine: targetEndLine + 1,
    startCharacter: targetRange.start.character,
    endCharacter: targetRange.end.character,
    sourceHash,
    hasSelection
  };
}

async function getDocumentSymbolRange(
  document: vscode.TextDocument,
  position: vscode.Position,
  mode: ContextMode
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

  return findEnclosingSymbol(symbols ?? [], position, kind => {
    if (mode === "function") return [vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor].includes(kind);
    if (mode === "class") return [vscode.SymbolKind.Class, vscode.SymbolKind.Struct, vscode.SymbolKind.Interface].includes(kind);
    return isExplainableSymbolKind(kind);
  });
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


function buildNumberedSnippet(
  document: vscode.TextDocument,
  startLine: number,
  endLine: number,
  maxCharacters = 120000
): string {
  const lines: string[] = [];
  let remaining = maxCharacters;

  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const line = document.lineAt(lineNumber);
    const content = `${lineNumber + 1}: ${line.text}`;
    if (content.length > remaining) {
      lines.push(`${content.slice(0, Math.max(0, remaining))}\n[contexte tronqué]`);
      break;
    }
    lines.push(content);
    remaining -= content.length + 1;
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
  >,
  remainingBudget: number
): Promise<RelatedSnippet[]> {
  if (!config.includeRelatedContext || !vscode.workspace.isTrusted || remainingBudget <= 0) {
    return [];
  }

  const maxSnippets = clampNumber(config.maxRelatedSnippets, 0, 8, 0);
  if (maxSnippets === 0) return [];
  const relatedLocations = await getRelatedLocations(document.uri, targetRange.start);
  if (!relatedLocations.length) {
    return [];
  }

  const maxLines = clampNumber(config.maxRelatedLinesPerSnippet, 8, 80, 28);
  const maxCharacters = Math.min(remainingBudget, clampNumber(config.maxContextCharacters, 4000, 120000, 8000));
  const snippets: RelatedSnippet[] = [];
  let consumedCharacters = 0;

  for (const candidate of relatedLocations) {
    if (snippets.length >= maxSnippets) {
      break;
    }

    if (!(await isSafeWorkspaceUri(candidate.uri))) {
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
  const [definition, typeDefinition, reference] = await Promise.allSettled([
    vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink> | undefined>("vscode.executeDefinitionProvider", uri, position),
    vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink> | undefined>("vscode.executeTypeDefinitionProvider", uri, position),
    vscode.commands.executeCommand<vscode.Location[] | undefined>("vscode.executeReferenceProvider", uri, position)
  ]);
  const definitionResult = definition.status === "fulfilled" ? definition.value : undefined;
  const typeDefinitionResult = typeDefinition.status === "fulfilled" ? typeDefinition.value : undefined;
  const referenceResult = reference.status === "fulfilled" ? reference.value : undefined;

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

  for (const item of typeDefinitionResult ?? []) {
    const normalized = normalizeLocation(item);
    if (!normalized) continue;
    const key = `${normalized.uri.toString()}:${normalized.range.start.line}:${normalized.range.start.character}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ ...normalized, reason: "type definition" });
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

async function isSafeWorkspaceUri(uri: vscode.Uri): Promise<boolean> {
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
  if (segments.some(isSensitivePathSegment)) return false;
  try {
    const [root, target, info] = await Promise.all([realpath(workspaceFolder.uri.fsPath), realpath(uri.fsPath), stat(uri.fsPath)]);
    const resolvedRelative = path.relative(root, target);
    return info.isFile() && info.size <= 1_000_000 && Boolean(resolvedRelative) &&
      resolvedRelative !== ".." && !resolvedRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(resolvedRelative) &&
      !resolvedRelative.split(path.sep).some(isSensitivePathSegment);
  } catch { return false; }
}

function isSensitivePathSegment(segment: string): boolean {
  return segment.startsWith(".") || /^(node_modules|secrets?|credentials)(?:\.|$)/i.test(segment) ||
    /^(id_rsa|id_ed25519)(?:\.|$)/i.test(segment) || /\.(pem|p12|pfx|key)$/i.test(segment);
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}
