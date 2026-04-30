# Security Policy

## Reporting A Vulnerability

Please do not open public GitHub issues for security vulnerabilities.

If you find a vulnerability, contact the maintainer privately. If no private contact is listed yet, open a minimal public issue that says you need a security contact, without including exploit details.

## Sensitive Data

Do not include any of the following in issues, pull requests, screenshots, logs, or demo files:

- API keys
- VS Code SecretStorage contents
- Private source code
- Proprietary prompts
- Personal access tokens
- Internal endpoints

## Provider Privacy

XPlanator is local-first by default with Ollama. Cloud providers are optional and should remain explicit user choices.

Any contribution that sends code to a new third-party service must document:

- What data is sent
- Which provider receives it
- How the user enables or disables it
- Where credentials are stored

See [SECURITY_MODEL.md](./SECURITY_MODEL.md) for the current API key and data-flow model.
