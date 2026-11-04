const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('an older response cannot overwrite a newer explanation', async () => {
  const oldLoad = Module._load, oldFetch = global.fetch;
  const commands = new Map(), state = new Map(), controllers = [];
  const disposable = { dispose() {} };
  class Position { constructor(line, character) { this.line = line; this.character = character; } }
  class Range { constructor(a, b, c, d) { this.start = typeof a === 'number' ? new Position(a, b) : a; this.end = typeof a === 'number' ? new Position(c, d) : b; } }
  const text = 'const x = 1;';
  const document = { fileName: '/work/example.ts', languageId: 'typescript', lineCount: 1, uri: { scheme: 'file' },
    lineAt: () => ({ text, range: new Range(new Position(0, 0), new Position(0, text.length)) }), offsetAt: position => position.character,
    getText: range => range ? text.slice(range.start.character, range.end.character) : text, getWordRangeAtPosition: () => undefined };
  const editor = { document, selection: { isEmpty: false, start: new Position(0, 0), end: new Position(0, text.length), active: new Position(0, text.length) } };
  const surface = { visible: true, webview: { html: '', postMessage: async () => true, onDidReceiveMessage() {} }, onDidDispose() {}, reveal() {} };
  const config = { provider: 'ollama', model: 'fake', ollamaUrl: 'http://localhost:11434' };
  const vscode = { Range, StatusBarAlignment: { Right: 1 }, ViewColumn: { Beside: 2 }, ConfigurationTarget: { Global: 1 },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return disposable; }, executeCommand: async () => [] },
    workspace: { isTrusted: true, textDocuments: [document], onDidChangeTextDocument: () => disposable, getConfiguration: () => ({ get: (key, fallback) => config[key] ?? fallback, update: async () => {} }) },
    window: { activeTextEditor: editor, createStatusBarItem: () => ({ ...disposable, hide() {}, show() {} }),
      onDidChangeActiveTextEditor: () => disposable, onDidChangeTextEditorSelection: () => disposable,
      createWebviewPanel: () => surface, showInformationMessage: async () => undefined, showErrorMessage: message => { throw new Error(message); } }
  };
  Module._load = function(name, ...args) { return name === 'vscode' ? vscode : oldLoad.call(this, name, ...args); };
  global.fetch = async () => new Response(new ReadableStream({ start(controller) { controllers.push(controller); } }));
  const context = { extensionUri: {}, subscriptions: [], globalState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => { state.set(key, value); } },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} } };
  const waitFor = async count => { for (let i = 0; i < 100 && controllers.length < count; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(controllers.length, count); };
  const finish = (controller, value) => { controller.enqueue(new TextEncoder().encode(JSON.stringify({ response: `Détails: ${value}`, done: true, done_reason: 'stop' }) + '\n')); controller.close(); };
  try {
    await require('../out/extension').activate(context);
    const first = commands.get('explainCode.explainSelection')();
    await waitFor(1);
    const second = commands.get('explainCode.explainSelection')();
    await waitFor(2);
    finish(controllers[1], 'new answer');
    await second;
    assert.match(surface.webview.html, /new answer/);
    finish(controllers[0], 'old answer');
    await first;
    assert.match(surface.webview.html, /new answer/);
    assert.doesNotMatch(surface.webview.html, /old answer/);
  } finally { Module._load = oldLoad; global.fetch = oldFetch; }
});
