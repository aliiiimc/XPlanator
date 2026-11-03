# Changelog

## 0.2.0

- Stream supported provider responses and allow cancellation; interrupted or truncated streams are reported as errors.
- Add provider profiles with destination-scoped credentials and migration from the active legacy settings.
- Support bounded contextual follow-up questions and examples.
- Add opt-in local history, deletion, Markdown export and source-change indicators.
- Display provider-reported usage and measured duration without fixed pricing estimates.
- Detect the enclosing symbol when the cursor is inside its body.
- Keep the previous explanation when reopening the panel and ignore stale generation results.
- Make connection checks catalog-only, reject redirects, and confirm changed endpoints before diagnostics.
- Preserve settings drafts while displaying diagnostic results.


- Treat source snippets as untrusted content in explanation prompts.
- Keep the latest selection available for retry when a provider API key is missing.

## 0.1.0

- Added OpenAI-compatible, Anthropic-compatible, Gemini, and local Ollama provider support.
- Added secure API key storage through VS Code SecretStorage.
- Added provider connection checks from the settings panel.
- Added endpoint validation and confirmation before saving endpoint changes.
- Added FreeModel safeguards for known mini/nano aliases that route to higher-cost models.
- Improved settings layout and button click feedback.
- Added an editor title bar button that opens the XPlanator panel without running an explanation.
- Added selectable explanation sections directly on the main section cards so users can generate only summary, details, takeaway, or any combination.
- Preserved the current editor group width when refreshing the XPlanator panel.
- Removed the old Free Lite provider from the public UI and configuration.
