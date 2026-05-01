# XPlanator

XPlanator is a VS Code extension for understanding code, not blindly generating more of it.

It explains the selected code or the symbol under your cursor in a clear side panel, with a short summary, deeper details, and one compact takeaway. It is local-first with Ollama by default, and it also supports personal API keys for OpenAI/Codex, Gemini, and Claude.

## Why This Exists

AI makes it easy to create code you do not fully understand. XPlanator helps beginners, students, indie hackers, and AI-assisted developers slow down for a moment and actually understand what a snippet does.

The goal is not to replace Copilot, Cursor, Continue, Codex, or Claude Code. The goal is smaller and sharper:

Understand this piece of code, right here, without leaving VS Code.

## Highlights

- Local-first by default with Ollama
- Optional BYOK cloud mode for OpenAI/Codex, Gemini, and Claude
- No XPlanator backend
- Explains a selection or the current cursor context
- `Plus simple` and `Plus detaille` follow-up buttons
- Separate sections for summary, details, and takeaway
- Copy buttons for each section
- Settings button inside the explanation panel
- French and English UI/answers
- Beginner-friendly prompt style

## Privacy Model

By default, XPlanator sends code only to your local Ollama server, usually `http://localhost:11434`.

If you choose a cloud provider in `Parametres`, the code you ask XPlanator to explain is sent directly to that provider using your own API key. API keys are stored with VS Code SecretStorage, not in this repository or in plain text configuration files.

Security details:

- API keys are never written to `settings.json`
- API keys are never displayed again after saving
- API keys are never logged by XPlanator
- Saved API keys can be deleted from the settings panel
- XPlanator has no hosted backend and does not proxy provider requests

Read [SECURITY_MODEL.md](./SECURITY_MODEL.md) for the full security model and verification notes.

## Who It Is For

- Beginners reading unfamiliar code
- Students learning JavaScript, TypeScript, Python, or other languages
- Developers reviewing AI-generated code
- Indie hackers who want to understand before shipping
- Teams that want a local-first explanation tool for onboarding

## Current Features

- Explain selected code
- Explain the current line or symbol under the cursor
- Ask for a simpler explanation
- Ask for a more detailed explanation
- Keep extra detail in `Details`, while `A retenir` stays short
- Choose the AI provider from the panel
- Configure the model name
- Save personal API keys securely through VS Code SecretStorage
- Check the configured AI provider connection
- Include nearby file context and related workspace snippets when available

## Providers

| Provider | Default model | Notes |
| --- | --- | --- |
| Ollama | `qwen2.5-coder` | Local, default, no API key |
| OpenAI / Codex | `gpt-5` | Requires API key |
| Gemini | `gemini-2.5-flash` | Requires API key |
| Claude | `claude-sonnet-4-5` | Requires API key |

Model names are editable. If a provider changes its model names, update the model field in `Parametres`.

## Local Development

### Requirements

- Node.js 18+
- VS Code
- Ollama, if you want local inference

### Install

```bash
npm install
npm run compile
```

For the default local model:

```bash
ollama pull qwen2.5-coder
```

### Run In VS Code

1. Open this folder in VS Code.
2. Press `F5`.
3. VS Code opens an `Extension Development Host` window.
4. Open a code file.
5. Select code and run `Explain Code: Explain Selection`.

## Usage

### Explain A Selection

1. Select a snippet.
2. Right click.
3. Choose `Explain Code: Explain Selection`.

### Explain At Cursor

1. Put the cursor on a line, variable, function, or class.
2. Open the Command Palette.
3. Run `Explain Code: Explain At Cursor`.

### Change Provider Or Model

1. Open an explanation panel.
2. Click `Parametres` in the bottom-right corner.
3. Choose `Ollama local`, `OpenAI / Codex`, `Gemini`, or `Claude`.
4. Enter the model name.
5. For cloud providers, paste your API key.
6. Click `Enregistrer`.

## VS Code Settings

- `explainCode.provider`: `ollama`, `openai`, `gemini`, or `anthropic`
- `explainCode.ollamaUrl`: local Ollama URL, default `http://localhost:11434`
- `explainCode.openAiBaseUrl`: OpenAI-compatible base URL, default `https://api.openai.com/v1`
- `explainCode.model`: model name
- `explainCode.responseStyle`: `simple`, `technical`, or `beginner`
- `explainCode.language`: `fr` or `en`
- `explainCode.timeoutSeconds`: AI provider request timeout (applies to all providers)
- `explainCode.includeRelatedContext`: include related snippets when available
- `explainCode.maxRelatedSnippets`: maximum related snippets
- `explainCode.maxRelatedLinesPerSnippet`: maximum lines per related snippet
- `explainCode.maxContextCharacters`: context character budget

## Commands

- `Explain Code: Explain Selection`
- `Explain Code: Explain At Cursor`
- `Explain Code: Explain More Simply`
- `Explain Code: Explain In More Detail`
- `Explain Code: Check AI Provider Connection`

## Roadmap

- Better first-run onboarding
- GIF/demo assets for the Marketplace and GitHub README
- Project-level explanation mode
- Dependency and call-flow view
- Learning mode with quiz questions
- Explanation history
- Markdown export
- Cost/token display for cloud providers
- Open VSX publishing
- VS Code Marketplace publishing

See [ROADMAP.md](./ROADMAP.md) for a more detailed version.

## Contributing

Contributions are welcome. Good first contributions include prompt improvements, provider fixes, UI polish, documentation, and tests around section parsing.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## Security

Please do not report security issues in public GitHub issues. See [SECURITY.md](./SECURITY.md).

## License

MIT. See [LICENSE](./LICENSE).
