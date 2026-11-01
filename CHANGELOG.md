# Changelog

## Unreleased

- Explain complete functions, methods, and types when the cursor is on their name.
- Use OpenAI's `max_completion_tokens` parameter for GPT-5 models and omit the unsupported custom temperature.
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
