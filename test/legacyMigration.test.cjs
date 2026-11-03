const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('published 0.1.x default model and saved key survive migration without assigning defaults to new users', async () => {
  const oldLoad = Module._load;
  const disposable = { dispose() {} };
  const vscode = { StatusBarAlignment: { Right: 1 }, ViewColumn: { Beside: 2 }, ConfigurationTarget: { Global: 1 },
    commands: { registerCommand: () => disposable },
    workspace: { onDidChangeTextDocument: () => disposable, getConfiguration: () => ({ get: (_key, fallback) => fallback, update: async () => {} }) },
    window: { createStatusBarItem: () => ({ ...disposable, hide() {}, show() {} }), onDidChangeActiveTextEditor: () => disposable,
      onDidChangeTextEditorSelection: () => disposable, showInformationMessage: async () => undefined }
  };
  Module._load = function(name, ...args) { return name === 'vscode' ? vscode : oldLoad.call(this, name, ...args); };
  const makeContext = existing => {
    const state = new Map(existing ? [['xplanator.hasSeenSetup', true]] : []);
    const keys = new Map(existing ? [['xplanator.openai.apiKey', 'legacy-key']] : []);
    return { state, keys, context: { extensionUri: {}, subscriptions: [], globalState: {
      get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => { state.set(key, value); }
    }, secrets: { get: async key => keys.get(key), store: async (key, value) => { keys.set(key, value); }, delete: async key => keys.delete(key) } } };
  };
  try {
    const extension = require('../out/extension');
    const old = makeContext(true);
    await extension.activate(old.context);
    assert.equal(old.state.get('xplanator.profiles.v1').profiles[0].model, 'gpt-5-nano');
    assert.equal([...old.keys.values()].filter(value => value === 'legacy-key').length, 2);
    const fresh = makeContext(false);
    await extension.activate(fresh.context);
    assert.equal(fresh.state.get('xplanator.profiles.v1').profiles[0].model, '');
  } finally { Module._load = oldLoad; }
});
