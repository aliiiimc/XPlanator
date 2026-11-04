import { test } from "node:test";
import { strict as assert } from "node:assert";
import type * as vscode from "vscode";
import { findEnclosingSymbol } from "./symbolSelection";

function range(start: number, end: number): vscode.Range {
  return { start: { line: start, character: 0 }, end: { line: end, character: 0 }, contains: (position: vscode.Position) => position.line >= start && position.line <= end } as vscode.Range;
}
function symbol(name: string, start: number, end: number, children: vscode.DocumentSymbol[] = []): vscode.DocumentSymbol {
  return { name, kind: 1, range: range(start, end), selectionRange: range(start, start), children } as vscode.DocumentSymbol;
}
test("cursor in method body selects method inside class", () => {
  const symbols = [symbol("Class", 0, 30, [symbol("method", 5, 20)])];
  assert.equal(findEnclosingSymbol(symbols, { line: 12 } as vscode.Position, () => true)?.name, "method");
  assert.equal(findEnclosingSymbol(symbols, { line: 5 } as vscode.Position, () => true)?.name, "method");
  assert.equal(findEnclosingSymbol(symbols, { line: 25 } as vscode.Position, () => true)?.name, "Class");
  assert.equal(findEnclosingSymbol(symbols, { line: 31 } as vscode.Position, () => true), undefined);
});
