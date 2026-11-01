# XPlanator

XPlanator is a VS Code extension that explains selected code directly inside the editor.

It is built for developers who want a focused explanation of the code in front of them: what it does, how it works, and what to remember before changing it. It supports OpenAI-compatible APIs, Meta Muse, Gemini, Claude, and local Ollama.

## Features

- Explain a selected block of code from the editor context menu
- Explain the current line, symbol, function, or class under the cursor
- Open a dedicated explanation panel from the editor title bar
- Choose the generated sections: summary, details, and takeaway
- Request a simpler or more detailed follow-up explanation
- Copy individual explanation sections
- Use OpenAI-compatible APIs, Gemini, Claude, or local Ollama
- Store API keys with VS Code SecretStorage
- Configure model, language, timeout, and context limits
- Optionally include nearby file context and related workspace snippets

## Why Use It

XPlanator is not a code generator. It is a reading and review tool.

Use it when you are onboarding to a codebase, reviewing AI-generated code, learning a new language or framework, or trying to understand a local implementation before editing it. The extension keeps the workflow inside VS Code and limits the request to the code context you choose.

<<<<<<< Updated upstream
- Local Ollama support when you want model-based explanations on your machine
- BYOK cloud mode for OpenAI/Codex, Gemini, and Claude
- No XPlanator backend
- Explains a selection or the current cursor context
- Opens from the editor title bar without starting an explanation
- Lets users tick the sections they want directly in the panel to reduce output tokens
- `Plus simple` and `Plus detaillÃ©` follow-up buttons
- Separate sections for summary, details, and takeaway
- Copy buttons for each section
- Settings button inside the explanation panel
- French and English UI/answers
- Beginner-friendly prompt style
=======
## Privacy And Provider Model
>>>>>>> Stashed changes

XPlanator does not run a hosted backend.

When using Ollama, requests are sent to your configured local Ollama endpoint, usually `http://localhost:11434`.

When using a cloud provider, the selected code and configured context are sent directly from VS Code to that provider using your own API key. API keys are stored through VS Code SecretStorage and are not written to `settings.json`.

Security behavior:

- API keys are not stored in plain text settings
- API keys are not logged by the extension
- Saved API keys can be deleted from the settings panel
- XPlanator does not proxy requests through a third-party service

See [SECURITY_MODEL.md](./SECURITY_MODEL.md) for implementation details.

## Supported Providers

| Provider | Default model | Notes |
| --- | --- | --- |
| OpenAI / Codex | `gpt-5-nano` | Default provider, requires an API key |
| Meta Muse | `muse-spark-1.3` | Requires a Meta Model API key |
| Ollama | `qwen2.5-coder` | Local provider, no API key required |
| Gemini | `gemini-2.5-flash` | Requires an API key |
| Claude | `claude-sonnet-4-5` | Requires an API key |

Model names are editable from the settings panel. If a provider changes model names, update the configured model value.

## Installation

Install XPlanator from the VS Code Marketplace, then reload VS Code if requested.

For local development:

```bash
npm install
npm run compile
```

To use the default Ollama model locally:

```bash
ollama pull qwen2.5-coder
```

## Usage

### Explain A Selection

1. Select code in the editor.
2. Right-click the selection.
3. Run `Explain Code: Explain Selection`.

You can also use the default keybinding:

```text
Ctrl+Alt+E
```

On macOS:

```text
Cmd+Alt+E
```

### Explain At Cursor

1. Place the cursor on a line, variable, function, or class.
2. Open the Command Palette.
3. Run `Explain Code: Explain At Cursor`.

### Open The Panel

Click the XPlanator icon in the editor title bar, or run:

```text
XPlanator: Open Panel
```

### Configure A Provider

1. Open the XPlanator panel.
2. Click `Parametres`.
3. Choose `Ollama local`, `OpenAI / Codex`, `Gemini`, `Claude`, or `Meta Muse`.
4. Click `Charger les modèles disponibles` and choose a model, or enter its name manually. The list may include models that are not compatible with text explanations or not enabled for your account.
5. For cloud providers, paste your API key.
6. Optionally run `Check connection`.
7. Click `Enregistrer`.

## Settings

XPlanator exposes the following VS Code settings:

- `explainCode.provider`: `ollama`, `openai`, `gemini`, `anthropic`, or `meta`
- `explainCode.ollamaUrl`: local Ollama URL, default `http://localhost:11434`
- `explainCode.openAiBaseUrl`: OpenAI-compatible base URL, default `https://api.openai.com/v1`
- `explainCode.anthropicBaseUrl`: Anthropic-compatible Messages API base URL, default `https://api.anthropic.com/v1`
- `explainCode.model`: model used for explanations
- `explainCode.explanationSections`: generated sections, any combination of `summary`, `details`, and `takeaway`
- `explainCode.responseStyle`: `simple`, `technical`, or `beginner`
- `explainCode.language`: `fr` or `en`
- `explainCode.timeoutSeconds`: provider request timeout
- `explainCode.includeRelatedContext`: include related workspace snippets when available
- `explainCode.maxRelatedSnippets`: maximum number of related snippets
- `explainCode.maxRelatedLinesPerSnippet`: maximum lines per related snippet
- `explainCode.maxContextCharacters`: total context character budget

Non-local provider URLs must use `https`. Local endpoints such as `localhost` and `127.0.0.1` may use `http`.

## Commands

- `XPlanator: Open Panel`
- `Explain Code: Explain Selection`
- `Explain Code: Explain At Cursor`
- `Explain Code: Explain More Simply`
- `Explain Code: Explain In More Detail`
- `Explain Code: Open Settings`
- `Explain Code: Check AI Provider Connection`

## Development

Run the extension locally:

1. Open this repository in VS Code.
2. Run `npm install`.
3. Run `npm run compile`.
4. Press `F5`.
5. Use the Extension Development Host window to test commands.

Run tests:

```bash
npm test
```

Package the extension:

```bash
vsce package
```

## Roadmap

- Marketplace demo assets
- Project-level explanation mode
- Dependency and call-flow view
- Learning mode with quiz questions
- Explanation history
- Markdown export
- Cost and token usage display for cloud providers
- Open VSX publishing

See [ROADMAP.md](./ROADMAP.md) for more details.

## Contributing

Contributions are welcome. Useful areas include provider compatibility, prompt quality, UI polish, documentation, and tests around explanation parsing.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## Security

Please do not report security issues in public GitHub issues. See [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
