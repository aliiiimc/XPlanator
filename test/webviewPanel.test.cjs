const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const vm = require('node:vm');

test('webview renders safe HTML and keeps settings drafts while generation finishes', () => {
  const original = Module._load;
  const messages = [];
  const surface = { title: '', visible: true, webview: { html: '', postMessage: value => { messages.push(value); }, onDidReceiveMessage() {} }, onDidDispose() {}, reveal() {} };
  const vscode = { ViewColumn: { Beside: 2 }, window: { createWebviewPanel: () => surface } };
  Module._load = function(name, ...args) { return name === 'vscode' ? vscode : original.call(this, name, ...args); };
  try {
    const { ExplanationPanel } = require('../out/webviewPanel');
    const panel = new ExplanationPanel({}, () => {}, () => 'profile <unsafe>');
    const sections = ['summary', 'details', 'takeaway'];
    panel.showEmptyState('fr', sections);
    assert.match(surface.webview.html, /profile &lt;unsafe&gt;/);
    assert.doesNotMatch(surface.webview.html, /data-action="moreSimple"/);
    const context = { fileName: 'file.ts', languageId: 'typescript', startLine: 1, endLine: 1, relatedSnippets: [] };
    panel.showLoading('Loading', 'fr', sections, context);
    assert.match(surface.webview.html, /data-action="cancelGeneration"/);
    panel.appendStream('<script>bad</script>');
    assert.equal(messages.at(-1).text, '<script>bad</script>'); // inserted with textContent in the webview
    const settings = { provider: 'openai', model: 'test', ollamaUrl: 'http://localhost:11434', openAiBaseUrl: 'https://api.openai.com/v1', anthropicBaseUrl: 'https://api.anthropic.com/v1', profileName: 'My profile', hasApiKey: false, providerStatus: { kind: 'idle', message: 'unchecked' } };
    panel.showSettings(settings, 'fr');
    const draftHtml = surface.webview.html;
    panel.showExplanation({ codeContext: context, explanation: 'Détails: <img src=x onerror=alert(1)>' }, 'fr', sections, true);
    assert.equal(surface.webview.html, draftHtml);
    panel.showExplanation({ codeContext: context, explanation: 'Détails: <img src=x onerror=alert(1)>' }, 'fr', sections);
    assert.doesNotMatch(surface.webview.html, /<img src=x/);
    assert.match(surface.webview.html, /&lt;img src=x/);
    const script = surface.webview.html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
    assert.doesNotThrow(() => new vm.Script(script));
  } finally { Module._load = original; }
});
