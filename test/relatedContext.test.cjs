const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

test('related context stays within a trusted workspace and skips sensitive and linked external files', async () => {
  const original = Module._load;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xplanator-test-'));
  const root = path.join(temp, 'workspace');
  fs.mkdirSync(root);
  const inside = path.join(root, 'helper.ts');
  const sensitive = path.join(root, '.env');
  const outside = path.join(temp, 'outside.ts');
  const link = path.join(root, 'linked.ts');
  for (const name of [inside, sensitive, outside]) fs.writeFileSync(name, 'const helper = 1;');
  let linked = false;
  try { fs.symlinkSync(outside, link, 'file'); linked = true; } catch { /* Windows may disallow symlink creation. */ }
  class Position { constructor(line, character) { this.line = line; this.character = character; } }
  class Range { constructor(a, b) { this.start = a; this.end = b; } contains() { return false; } }
  class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
  const uri = name => ({ scheme: 'file', fsPath: name, toString: () => name });
  const point = new Position(0, 0);
  const location = name => new Location(uri(name), new Range(point, new Position(0, 5)));
  let trusted = true;
  let opened = 0;
  const vscode = {
    Range, Location, SymbolKind: { Class: 1, Constructor: 2, Enum: 3, Function: 4, Interface: 5, Method: 6, Module: 7, Struct: 8, TypeParameter: 9 },
    commands: { executeCommand: async name => name === 'vscode.executeDefinitionProvider' ? [location(outside), location(sensitive), ...(linked ? [location(link)] : []), location(inside)] : [] },
    workspace: {
      get isTrusted() { return trusted; },
      getWorkspaceFolder: value => value.fsPath.startsWith(root + path.sep) ? { uri: { fsPath: root } } : undefined,
      openTextDocument: async value => { opened++; const content = fs.readFileSync(value.fsPath, 'utf8'); return { fileName: value.fsPath, languageId: 'typescript', lineCount: 1, lineAt: () => ({ text: content }) }; }
    }
  };
  Module._load = function(name, ...args) { return name === 'vscode' ? vscode : original.call(this, name, ...args); };
  try {
    const { getCodeContext } = require('../out/contextExtractor');
    const source = 'const x = dep;';
    const sourceUri = uri(path.join(root, 'main.ts'));
    const document = { fileName: sourceUri.fsPath, languageId: 'typescript', uri: sourceUri, lineCount: 1,
      lineAt: () => ({ text: source, range: new Range(point, new Position(0, source.length)) }),
      offsetAt: position => position.character,
      getText: range => source.slice(range.start.character, range.end.character), getWordRangeAtPosition: () => undefined };
    const editor = { document, selection: { isEmpty: false, start: point, end: new Position(0, source.length), active: point } };
    const config = { maxSurroundingLines: 20, includeRelatedContext: true, maxRelatedSnippets: 8, maxRelatedLinesPerSnippet: 8, maxContextCharacters: 8000 };
    const result = await getCodeContext(editor, config, true);
    assert.deepEqual(result.relatedSnippets.map(item => item.filePath), [inside]);
    assert.equal(opened, 1);
    trusted = false;
    assert.deepEqual((await getCodeContext(editor, config, true)).relatedSnippets, []);
    assert.equal(opened, 1);
  } finally {
    Module._load = original;
    const resolved = path.resolve(temp);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('xplanator-test-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
});
