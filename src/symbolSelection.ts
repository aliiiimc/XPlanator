import type * as vscode from "vscode";

/** Select the innermost explainable symbol containing the cursor. */
export function findEnclosingSymbol(
  symbols: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[],
  position: vscode.Position,
  isExplainable: (kind: vscode.SymbolKind) => boolean
): { name: string; range: vscode.Range } | undefined {
  const candidates: Array<{ name: string; range: vscode.Range; depth: number }> = [];
  const visit = (symbol: vscode.DocumentSymbol | vscode.SymbolInformation, depth: number): void => {
    const range = "children" in symbol ? symbol.range : symbol.location.range;
    if (isExplainable(symbol.kind) && range.contains(position)) candidates.push({ name: symbol.name, range, depth });
    if ("children" in symbol) for (const child of symbol.children) visit(child, depth + 1);
  };
  for (const symbol of symbols) visit(symbol, 0);
  const size = (range: vscode.Range): number => (range.end.line - range.start.line) * 100000 + range.end.character - range.start.character;
  candidates.sort ( (a, b) => b.depth - a.depth || size(a.range) - size(b.range) );
  return candidates[0];
}
