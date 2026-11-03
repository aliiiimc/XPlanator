const assert = require('node:assert/strict');
const http = require('node:http');
const vscode = require('vscode');

exports.run = async function() {
  const received = [];
  const server = http.createServer((request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ models: [{ name: 'test-model:latest' }] }));
      return;
    }
    let input = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { input += chunk; });
    request.on('end', () => {
      received.push(JSON.parse(input));
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.write(JSON.stringify({ response: 'Résumé: additionne.\n', done: false }) + '\n');
      response.end(JSON.stringify({ response: 'Détails: retourne deux.', done: true, done_reason: 'stop', prompt_eval_count: 5, eval_count: 3, model: 'test-model' }) + '\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const config = vscode.workspace.getConfiguration('explainCode');
    await config.update('provider', 'ollama', vscode.ConfigurationTarget.Global);
    await config.update('model', 'test-model', vscode.ConfigurationTarget.Global);
    await config.update('ollamaUrl', endpoint, vscode.ConfigurationTarget.Global);
    const extension = vscode.extensions.getExtension('aliiiimc.xplanator');
    assert.ok(extension, 'development extension is installed');
    await extension.activate();
    const document = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'const total = 1 + 1;' });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 0, 20);
    await vscode.commands.executeCommand('explainCode.explainSelection');
    assert.equal(received.length, 1);
    assert.equal(received[0].model, 'test-model');
    assert.equal(received[0].stream, true);
    assert.match(received[0].prompt, /const total = 1 \+ 1/);
    assert.ok(vscode.window.tabGroups.all.flatMap(group => group.tabs).some(tab => tab.label.includes('XPlanator')));
    console.log('PASS: extension host activation, selected context and streaming generation');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
};
