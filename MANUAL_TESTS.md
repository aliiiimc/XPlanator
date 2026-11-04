# Manual release checks

Use synthetic, non-sensitive code and dedicated provider keys. Cloud tests can be billed; inspect the provider's pricing and account permissions first. Never paste keys into logs, screenshots or issue reports.

1. Run `npm ci`, `npm test`, then `npx @vscode/vsce package`. Install the resulting VSIX in a disposable VS Code profile and reload.
2. Open XPlanator, create a profile, enter a provider's documented endpoint and a model actually available to the account. Load the model catalog. Verify that the catalog check says generation is unverified.
3. For Ollama, start a local server and choose an installed model. For OpenAI, Anthropic, Gemini, Meta or an OpenAI-compatible endpoint, use a separate appropriately scoped API key. Save the key; reopen settings and verify it is not displayed.
4. If authorized to incur charges, choose **Test generation**, read the destination and cost warning, and confirm. Record only provider, model ID, date, result and error category. Repeat with a deliberately invalid model and, in a test profile, invalid credentials. Do not run quota-exhaustion tests on production accounts.
5. In a test file, select several lines, explain them, and verify that text appears incrementally. Repeat with the cursor inside a nested method; try the line, function, class and file context modes. Verify that empty and oversized targets produce understandable errors.
6. Start a long generation, cancel it, then start another. Confirm that late content from the first request cannot replace the second. Switch files and reopen the panel; the existing explanation should remain.
7. Ask a question about a specific part of the response, then ask for an example. Confirm the answer relates to the preceding code and explanation. Change the source and verify the panel indicates that the snapshot is stale.
8. Open settings while a response is still streaming and edit a field. The completed response should not replace the settings page or erase the draft. Try dark, light and high-contrast themes, keyboard-only navigation, a narrow panel and reduced motion.
9. Enable history only with synthetic data. Save and restore an explanation with follow-ups, export Markdown, delete one entry, clear the rest, then disable history. Confirm that a `.env` file and recognizable synthetic credential patterns are not stored; do not rely on the filter for real secrets.
10. Create two profiles with different providers or endpoints, save different keys, switch between them and inspect provider-side request logs for the selected model and destination. Verify a changed endpoint does not receive the previous endpoint's key. Test migration in a disposable VS Code profile with legacy settings and keys.
11. Review the installed package for accidental source maps, `.env` files, local history, keys, test files and existing VSIX files. Check command names, README and Marketplace metadata against observed behavior.

Record the VS Code version, OS, provider/model and observed results. Mocks are not evidence that a real account, model or cloud endpoint works.
