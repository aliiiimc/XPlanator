const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('activation migrates credentials and switches provider destinations independently', async () => {
  const previousLoad = Module._load;
  const previousFetch = global.fetch;
  const commands = new Map();
  const state = new Map();
  const secret = new Map([['xplanator.openai.apiKey', 'openai-key']]);
  const picks = [];
  const inputs = [];
  const calls = [];
  let receiver;
  const webview = { html: '', postMessage: async () => true, onDidReceiveMessage: callback => { receiver = callback; } };
  const disposable = { dispose() {} };
  const config = { provider: 'openai', model: 'open-model', openAiBaseUrl: 'https://api.openai.com/v1' };
  const vscode = {
    StatusBarAlignment: { Right: 1 }, ViewColumn: { Beside: 2 }, ConfigurationTarget: { Global: 1 },
    commands: { registerCommand: (name, fn) => { commands.set(name, fn); return disposable; }, executeCommand: async (name, ...args) => commands.get(name)?.(...args) },
    workspace: { onDidChangeTextDocument: () => disposable, getConfiguration: () => ({ get: (key, fallback) => config[key] ?? fallback, update: async () => {} }) },
    window: {
      createStatusBarItem: () => ({ ...disposable, hide() {}, show() {} }),
      onDidChangeActiveTextEditor: () => disposable, onDidChangeTextEditorSelection: () => disposable,
      createWebviewPanel: () => ({ webview, visible: true, onDidDispose() {}, reveal() {} }),
      showInformationMessage: async () => undefined, showWarningMessage: async () => undefined,
      showErrorMessage: message => { throw new Error(message); },
      showQuickPick: async options => options.find(item => item.id === picks.shift() || item.provider === picks[0]),
      showInputBox: async () => inputs.shift()
    },
    env: { clipboard: { writeText: async () => {} } }
  };
  // Pick a specified ID or provider without consuming the queued value per option.
  vscode.window.showQuickPick = async options => { const pick = picks.shift(); return options.find(item => item.id === pick || item.provider === pick); };
  Module._load = function(name, ...rest) { return name === 'vscode' ? vscode : previousLoad.call(this, name, ...rest); };
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers });
    return new Response(JSON.stringify({ data: [{ id: 'model' }] }), { status: 200 });
  };
  const context = {
    extensionUri: {}, subscriptions: [],
    globalState: { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => { state.set(key, value); } },
    secrets: { get: async key => secret.get(key), store: async (key, value) => { secret.set(key, value); }, delete: async key => { secret.delete(key); } }
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve)); };
  try {
    const extension = require('../out/extension');
    await extension.activate(context);
    await commands.get('explainCode.checkOllama')();
    assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
    assert.equal(calls[0].headers.Authorization, 'Bearer openai-key');
    await commands.get('explainCode.openSettings')();
    picks.push('new', 'anthropic');
    inputs.push('Claude profile', 'claude-model', 'https://anthropic.example/v1');
    receiver({ action: 'profiles' });
    await settle();
    const profiles = state.get('xplanator.profiles.v1');
    assert.equal(profiles.profiles.length, 2);
    receiver({ action: 'saveSettings', settings: { provider: 'anthropic', model: 'claude-model', ollamaUrl: 'http://localhost:11434', openAiBaseUrl: 'https://api.openai.com/v1', anthropicBaseUrl: 'https://anthropic.example/v1', apiKey: 'claude-key' } });
    await settle();
    await commands.get('explainCode.checkOllama')();
    assert.equal(calls[1].url, 'https://anthropic.example/v1/models?limit=100');
    assert.equal(calls[1].headers['x-api-key'], 'claude-key');
    picks.push(profiles.profiles[0].id);
    receiver({ action: 'profiles' });
    await settle();
    await commands.get('explainCode.checkOllama')();
    assert.equal(calls[2].url, 'https://api.openai.com/v1/models');
    assert.equal(calls[2].headers.Authorization, 'Bearer openai-key');
    assert.doesNotMatch(JSON.stringify([...state]), /openai-key|claude-key/);
  } finally {
    Module._load = previousLoad;
    global.fetch = previousFetch;
  }
});
