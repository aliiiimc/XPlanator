# XPlanator

XPlanator helps you understand code in VS Code. Select code or put the cursor inside a symbol, then ask for a focused explanation. The extension does not edit your source code or run its own hosted backend.

## What it does

- Explain a selection, the current line, an enclosing function or class, or a bounded file.
- Choose summary, details and takeaway sections; copy them individually.
- Stream responses, cancel a request, and ask bounded follow-up questions or request examples.
- Manage independent provider profiles and discover model identifiers from a provider's catalog.
- Optionally save local history, reopen a conversation, delete entries or export Markdown.
- Show provider-reported token counts when available and locally measured duration. Costs are not calculated.

## Install and configure

Install XPlanator from the VS Code Marketplace, or install a development VSIX with **Extensions: Install from VSIX...**. Reload VS Code if prompted.

1. Open the XPlanator panel from the editor title bar or **XPlanator: Open Panel**, then open **Settings**.
2. Use the profile manager to create or select OpenAI or an OpenAI-compatible endpoint, Anthropic, Gemini, Meta Model API, or Ollama. The initial OpenAI profile is created automatically.
3. Enter a model identifier from your provider, or load its catalog and select one. A listed model may still be unavailable for generation to your account. XPlanator does not assume a default model.
4. For a cloud provider, enter an API key and save. For Ollama, start a local server and install a model using Ollama's own instructions. An Ollama endpoint on a remote host is not local merely because it uses the Ollama protocol.
5. **Check connection** checks only the model catalog. The separate **Test generation** button sends a short synthetic prompt after confirmation; it can be billed.
6. Select code and run **Explain Code: Explain Selection**, or use **Explain At Cursor**. Use **XPlanator: Explain with Context Mode** to choose selection, line, function, class or bounded file. The shortcut for a selection is `Ctrl+Alt+E` (`Cmd+Alt+E` on macOS).

A ChatGPT, Claude or Gemini subscription does not necessarily include API access. Provider billing and availability depend on your own account. Review provider pricing before testing cloud generation.

## Profiles and generation

Profiles keep their model, endpoint, timeout and optional structured-output preference independently. Keys are stored in VS Code SecretStorage per profile and destination; changing an endpoint requires a key for the new destination. Existing settings and the active provider key are migrated on first activation. Other legacy keys are imported when a profile for that provider is created with the matching original endpoint. Legacy keys remain available for rollback.

The profile manager can enable structured JSON output when you have verified that the selected model and API support it. Unsupported servers may reject it; disable the option to use the plain-text fallback. Structured replies are validated and empty or malformed output is reported as an error. Follow-up questions currently use plain text.

The catalog diagnostic checks access to a listing, not the ability to generate. Generation test success means only that the selected model returned a valid short response for that test. Streamed responses which are empty, interrupted, refused or truncated are not reported as successful. Compatible APIs may implement only part of the expected protocol.

## Context and privacy

Before a new remote generation, XPlanator shows its destination and offers a preview of the exact text prompt. A confirmation is remembered in memory for the same prompt and destination during the session. Localhost requests do not display this remote-transfer prompt. Related snippets are optional, limited to trusted workspaces, bounded by a character budget and filtered for common sensitive paths, large files and links outside the workspace. These measures cannot guarantee that confidential data is excluded from an explicitly selected snippet or from every related file. Review the preview before sending.

API keys are stored through SecretStorage, not plain-text settings. Network redirects are refused. The selected provider receives the prompt and applies its own retention and security policies. See [SECURITY_MODEL.md](./SECURITY_MODEL.md).

History is **off by default**. Enabling it stores local snapshots of code, explanations and questions in VS Code extension state. Common credential patterns and sensitive paths are filtered on a best-effort basis; no filter detects all confidential information. Set `explainCode.historyLimit` to control retention. Disabling history stops future saves but does not delete existing entries; use the History menu to delete them. XPlanator marks a snapshot when the original source differs or cannot be checked.

## Preferences

The panel groups connection, explanation and context options. Choose language, learning level and response length; change the maximum context size, surrounding lines and optional related snippets. Advanced options include the current profile's endpoint and timeout. The section checkboxes on the main panel control the next explanation.

VS Code settings also expose `explainCode.language`, `responseStyle`, `responseLength`, `explanationSections`, `maxSurroundingLines`, `includeRelatedContext`, `maxRelatedSnippets`, `maxRelatedLinesPerSnippet`, `maxContextCharacters`, `historyEnabled` and `historyLimit`. Legacy provider, endpoint, model and timeout settings are used for migration; after migration use the profile manager for these values.

## Development and verification

```sh
npm ci
npm test
npx @vscode/vsce package
```

To test the extension interactively, open the repository in VS Code, compile with `npm run compile`, press **F5** and use the Extension Development Host. `test/extensionHost.cjs` is an additional host smoke test; the automated `npm test` suite uses simulated providers and does not need paid keys. [MANUAL_TESTS.md](./MANUAL_TESTS.md) covers real-provider and UI checks; [PACKAGING.md](./PACKAGING.md) describes packaging and release checks.

Streaming and structured output have been exercised against local Ollama with `qwen2.5-coder:latest`; cloud provider protocols have been tested with mocks, not live accounts. UI behavior and current VS Code compatibility still require a full interactive release check. See [ROADMAP.md](./ROADMAP.md) for remaining work.

## Security and contribution

Report security issues privately as described in [SECURITY.md](./SECURITY.md). Contributions are welcome; see [CONTRIBUTING.md](./CONTRIBUTING.md). License: MIT.
