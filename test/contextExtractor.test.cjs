const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('context modes select the intended symbol, line or selection and reject oversized content', async () => {
  const original = Module._load;
  class Position { constructor(line, character) { this.line = line; this.character = character; } }
  class Range {
    constructor(a, b, c, d) { this.start = typeof a === 'number' ? new Position(a, b) : a; this.end = typeof a === 'number' ? new Position(c, d) : b; }
    contains(p) { return (p.line > this.start.line || p.line === this.start.line && p.character >= this.start.character) && (p.line < this.end.line || p.line === this.end.line && p.character <= this.end.character); }
  }
  const kinds = { Class: 1, Constructor: 2, Enum: 3, Function: 4, Interface: 5, Method: 6, Module: 7, Struct: 8, TypeParameter: 9 };
  let symbols = [];
  const vscode = { Range, SymbolKind: kinds, commands: { executeCommand: async () => symbols }, workspace: { isTrusted: true } };
  Module._load = function(name, ...args) { return name === 'vscode' ? vscode : original.call(this, name, ...args); };
  const { getCodeContext } = require('../out/contextExtractor');
  const lines = ['class Box {', '  run() {', '    return 42;', '  }', '}'];
  const text = lines.join('\n');
  const pos = (line, character) => new Position(line, character);
  const document = {
    fileName: '/work/demo.ts', languageId: 'typescript', uri: {}, lineCount: lines.length,
    lineAt: line => ({ text: lines[line], range: new Range(pos(line, 0), pos(line, lines[line].length)) }),
    offsetAt: p => lines.slice(0, p.line).reduce((n, value) => n + value.length + 1, 0) + p.character,
    getText(range) { return text.slice(this.offsetAt(range.start), this.offsetAt(range.end)); },
    getWordRangeAtPosition: () => new Range(pos(2, 4), pos(2, 10))
  };
  const config = { maxSurroundingLines: 20, includeRelatedContext: false, maxRelatedSnippets: 0, maxRelatedLinesPerSnippet: 28, maxContextCharacters: 4000 };
  const selection = { isEmpty: true, active: pos(2, 6), start: pos(2, 6), end: pos(2, 6) };
  const editor = { document, selection };
  symbols = [{ name: 'Box', kind: kinds.Class, range: new Range(pos(0, 0), pos(4, 1)), selectionRange: new Range(pos(0, 6), pos(0, 9)), children: [
    { name: 'run', kind: kinds.Method, range: new Range(pos(1, 2), pos(3, 3)), selectionRange: new Range(pos(1, 2), pos(1, 5)), children: [] }
  ] }];
  try {
    assert.match((await getCodeContext(editor, config, false)).selectedCode, /^run\(\)/);
    assert.match((await getCodeContext(editor, config, false, 'class')).selectedCode, /^class Box/);
    assert.equal((await getCodeContext(editor, config, false, 'line')).selectedCode, 'return 42;');
    editor.selection = { isEmpty: false, active: pos(2, 14), start: pos(1, 2), end: pos(2, 14) };
    assert.equal((await getCodeContext(editor, config, true, 'selection')).selectedCode, 'run() {\n    return 42;');
    editor.selection = selection;
    await assert.rejects(getCodeContext(editor, config, false, 'selection'), /Sélectionnez/);
    symbols = [];
    assert.equal((await getCodeContext(editor, config, false)).selectedCode, 'return 42;');
    await assert.rejects(getCodeContext(editor, config, false, 'function'), /Aucune fonction/);
    const huge = 'x'.repeat(12001);
    const bigDoc = { ...document, lineCount: 1, lineAt: () => ({ text: huge, range: new Range(pos(0, 0), pos(0, huge.length)) }), offsetAt: p => p.character };
    await assert.rejects(getCodeContext({ document: bigDoc, selection: { ...selection, active: pos(0, 0) } }, config, false, 'file'), /volumineux/);
    const wide = 'x'.repeat(7000);
    const wideDoc = { ...document, lineCount: 1, lineAt: () => ({ text: wide, range: new Range(pos(0, 0), pos(0, wide.length)) }),
      offsetAt: p => p.character, getText: range => wide.slice(range.start.character, range.end.character), getWordRangeAtPosition: () => undefined };
    const wideSelection = { isEmpty: false, active: pos(0, 10), start: pos(0, 0), end: pos(0, 10) };
    const bounded = await getCodeContext({ document: wideDoc, selection: wideSelection }, config, true, 'selection');
    assert.ok(bounded.selectedCode.length + bounded.surroundingCode.length <= config.maxContextCharacters);
  } finally { Module._load = original; }
});
