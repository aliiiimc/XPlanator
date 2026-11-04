# Security model

XPlanator has no project-operated backend. It sends requests from the extension host to the configured destination. The selected provider can retain or process submitted data according to its own policies; using the Ollama protocol with a remote endpoint does not make that endpoint local.

## Credentials and destinations

Keys are stored using VS Code SecretStorage and associated with a profile and normalized endpoint. They are not written to settings or intentionally logged. The settings field starts empty; an entered key is sent to the extension host for saving or testing. Redirects are rejected. Non-loopback endpoints require HTTPS. Changing an endpoint does not reuse the prior endpoint's key. The legacy provider key is retained after migration for rollback; another provider's legacy key is imported only for its original endpoint.

A connection check reads the model catalog and sends no code. The separate generation test sends a short synthetic prompt only after confirmation and may incur charges. The generation preview shows the destination and the actual prompt before remote transmission. Confirmations are held in memory for the same prompt and destination during the session.

## Source data and history

An explanation request may include the selected code, surrounding lines, optional related workspace snippets and bounded conversation history. Related collection is disabled in untrusted workspaces, excludes common sensitive paths, checks resolved paths against the workspace and skips large related files. These are best-effort safeguards, not a guarantee that confidential data is absent. Review the preview and your provider's policies.

Local history is opt-in. It stores source snapshots, explanations and questions in local extension state. Its limited sensitive-data filter cannot detect every secret. The user can disable future saves, delete entries or clear history; Markdown export writes explanation and conversation text to a chosen file.

## Limits

Compromise of the operating system account, VS Code or the system keychain can expose local data. Use appropriately scoped keys and revoke them when necessary. Source content and model output are treated as untrusted data; model output is escaped before rendering and the webview has a restrictive content security policy. No filtering or prompt instruction can guarantee that a model ignores malicious instructions in code.

Implementation: `src/profiles.ts` manages profile-scoped SecretStorage references, `src/providers/` constructs provider requests, `src/contextExtractor.ts` bounds context, `src/history.ts` manages opt-in local history and `src/webviewPanel.ts` renders escaped content.
