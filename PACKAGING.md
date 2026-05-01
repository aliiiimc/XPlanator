# Packaging XPlanator

These notes keep the first public package predictable for VS Code Marketplace and Open VSX.

## Preflight

Run the full local check before packaging:

```bash
npm install
npm test
```

Review these files before publishing:

- `README.md`
- `SECURITY.md`
- `SECURITY_MODEL.md`
- `LICENSE`
- `.gitignore`

Do not package local secrets, `.env` files, logs, or development `.vsix` files.

## VS Code Marketplace

Use the official VS Code extension packaging tool:

```bash
npx @vscode/vsce package
```

Before publishing, replace the placeholder `publisher` field in `package.json` with the real Marketplace publisher id.

## Open VSX

Open VSX uses a separate publishing flow:

```bash
npx ovsx package
```

Before publishing, verify the namespace/publisher account and reuse the same generated `.vsix` only after `npm test` passes.

## Release Checklist

- Confirm the extension starts in an Extension Development Host.
- Test `Explain Selection` with Ollama.
- Test `Open Settings` and `Check connection`.
- Test one cloud provider path with a throwaway API key if a release claims cloud-provider support.
- Confirm non-local custom endpoints require HTTPS.
- Confirm no API keys or private source snippets appear in screenshots or release assets.
