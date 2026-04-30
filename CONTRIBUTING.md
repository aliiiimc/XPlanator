# Contributing To XPlanator

Thanks for helping improve XPlanator.

The project is intentionally narrow: help developers understand code inside VS Code, with local-first defaults and optional bring-your-own-key cloud providers.

## Good First Contributions

- Improve prompts for clearer beginner explanations
- Fix provider-specific API behavior
- Improve French or English copy
- Add tests around parsing `Summary`, `Details`, and `Takeaway`
- Improve accessibility in the webview
- Improve README examples and screenshots
- Add support for another OpenAI-compatible provider

## Development Setup

```bash
npm install
npm run compile
```

Then open the project in VS Code and press `F5` to launch the Extension Development Host.

## Pull Request Checklist

- Keep the scope small and focused
- Run `npm run compile`
- Update documentation when behavior changes
- Do not commit API keys, tokens, screenshots containing secrets, or local user data
- Keep the local-first privacy model intact

## Code Style

- TypeScript strict mode is enabled
- Prefer small functions with explicit types at module boundaries
- Keep provider-specific logic in `src/aiClient.ts`
- Keep prompt format changes in `src/promptBuilder.ts`
- Keep webview rendering and parsing behavior in `src/webviewPanel.ts`

## Privacy Expectations

XPlanator should not introduce a project-owned backend without a clear discussion and documentation update.

If a feature sends code to any third-party service, it must be optional, visible to the user, and configurable.
