const assert = require('node:assert/strict');
const http = require('node:http');
const vscode = require('vscode');

exports.run = async function() {
  const received = [];
  const liveEndpoint = process.env.XPLANATOR_TEST_OLLAMA_URL;
  const model = process.env.XPLANATOR_TEST_OLLAMA_MODEL || 'test-model';
  let streamed = '';
  const server = http.createServer((request, response) => {
    if (request.url === '/api/tags') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ models: [{ name: `${model}:latest` }] }));
      return;
    }
    let input = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { input += chunk; });
    request.on('end', async () => {
      received.push(JSON.parse(input));
      if (liveEndpoint) {
        try {
          const upstream = await fetch(`${liveEndpoint}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: input });
          response.writeHead(upstream.status, { 'content-type': 'application/x-ndjson' });
          for await (const chunk of upstream.body) { streamed += Buffer.from(chunk).toString('utf8'); response.write(chunk); }
          response.end();
        } catch (error) { response.destroy(error); }
        return;
      }
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
    await config.update('model', model, vscode.ConfigurationTarget.Global);
    await config.update('ollamaUrl', endpoint, vscode.ConfigurationTarget.Global);
    await config.update('timeoutSeconds', 180, vscode.ConfigurationTarget.Global);
    const extension = vscode.extensions.getExtension('aliiiimc.xplanator');
    assert.ok(extension, 'development extension is installed');
    await extension.activate();
    const document = await vscode.workspace.openTextDocument({ language: 'typescript', content: 'const total = 1 + 1;' });
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 0, 0, 20);
    await vscode.commands.executeCommand('explainCode.explainSelection');
    assert.equal(received.length, 1);
    assert.equal(received[0].model, model);
    assert.equal(received[0].stream, true);
    assert.match(received[0].prompt, /const total = 1 \+ 1/);
    if (liveEndpoint) {
      const events = streamed.trim().split('\n').map(line => JSON.parse(line));
      assert.ok(events.some(event => event.response), 'model returned text');
      assert.ok(events.some(event => event.done && event.done_reason === 'stop'), 'model completed normally');
    }
    let tabs = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      tabs = vscode.window.tabGroups.all.flatMap(group => group.tabs);
      if (tabs.some(tab => tab.label.includes('XPlanator'))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(tabs.some(tab => tab.label.includes('XPlanator')), `XPlanator tab missing: ${tabs.map(tab => tab.label).join(', ')}`);
    console.log(`PASS: extension host activation, selected context and ${liveEndpoint ? 'real Ollama' : 'mock'} streaming generation`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
};
