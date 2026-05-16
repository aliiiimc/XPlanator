# Security Model

XPlanator is designed to be local-first and transparent about when data leaves the user's machine.

This document explains how API keys and code snippets are handled.

## Short Version

- XPlanator has no project-owned backend.
- Free Lite is the default provider and does not send code anywhere.
- Ollama runs locally when selected.
- Cloud providers are optional and user-configured.
- API keys are stored with VS Code `SecretStorage`.
- API keys are never written to `settings.json`.
- API keys are never shown again after saving.
- API keys are never logged by XPlanator.
- API keys are only read when making a request to the selected provider.
- Free Lite does not read API keys, call a model, or make network requests.
- The configured provider request timeout applies to all AI provider HTTP requests.
- Ollama uses a reduced-context profile by default to avoid sending unnecessarily large prompts to local models.
- Saved keys can be deleted from the XPlanator settings panel.
- Non-local custom provider URLs must use HTTPS.
- Endpoint URL changes require an explicit confirmation before they are saved.

## API Key Flow

1. The user opens `Parametres`.
2. The API key field is empty, even when a key already exists.
3. If the user enters a key and clicks `Enregistrer`, the webview sends it once to the extension host.
4. The extension stores it with `context.secrets`, VS Code's `SecretStorage`.
5. Later, when a cloud provider is used, the extension reads the key from `SecretStorage`.
6. The key is added to the HTTPS request header for that provider.
7. The key is not included in the prompt, response, logs, README, settings, or webview HTML.
8. The user can verify provider connectivity from the settings panel before saving changes.

## What Is Sent To Providers

### Free Lite

When `lite` is selected, XPlanator generates a structural explanation inside the extension host. No code, context, model request, or API key is sent anywhere.

### Ollama

When `ollama` is selected, requests are sent to the configured local Ollama URL, usually `http://localhost:11434`.

### OpenAI / Codex

When `openai` is selected, the selected code and context are sent to the configured OpenAI-compatible base URL.

### Gemini

When `gemini` is selected, the selected code and context are sent to the Gemini API.

### Claude

When `anthropic` is selected, the selected code and context are sent to the configured Anthropic-compatible Messages API base URL.

## What XPlanator Does Not Do

- It does not run a hosted backend.
- It does not proxy API requests through a XPlanator server.
- It does not store API keys in workspace files.
- It does not store API keys in VS Code settings.
- It does not print API keys to logs.
- It does not include API keys in copied explanation text.
- It does not intentionally collect telemetry.

## Current Code Evidence

Relevant files:

- `src/aiClient.ts`: reads and stores secrets through `vscode.SecretStorage`
- `src/liteExplainer.ts`: generates Free Lite explanations without provider requests
- `src/webviewPanel.ts`: renders the API key input empty and only sends a new value when the user saves
- `src/extension.ts`: saves provider settings and routes requests
- `.gitignore`: excludes `.env`, `.env.*`, logs, and packaged `.vsix` files

Useful checks:

```bash
Select-String -Path src\*.ts -Pattern "apiKey","SecretStorage","console.log","settings.json"
npm run compile
```

## Limitations

No extension can honestly promise that a key is impossible to access under all conditions.

Important limits:

- If the user's operating system account is compromised, local secrets may be at risk.
- If VS Code or the OS keychain is compromised, secrets may be at risk.
- Cloud providers receive the selected code/context when the user chooses a cloud provider.
- Free Lite is structural and deterministic; it is less capable than a model and should not be treated as deep semantic analysis.
- The selected provider's own security and data-retention policies still apply.
- Users should create scoped API keys when the provider supports it, rotate keys periodically, and revoke keys they no longer use.

## Recommended User Practices

- Use Ollama for private or proprietary code when possible.
- Use provider keys with the minimum required permissions.
- Rotate API keys periodically.
- Delete saved keys from XPlanator when no longer needed.
- Review the source code before installing development builds.
