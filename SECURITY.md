# Security policy

## Supported version

Security fixes are applied to the current `main` branch. This project does not currently publish maintained release branches.

## Reporting a vulnerability

Do not open a public issue containing exploit details, private graph content, credentials, hostnames, or personal data. Use GitHub's **Security → Report a vulnerability** private reporting form for this repository. If private vulnerability reporting is unavailable, open a public issue asking the maintainer for a private contact channel without including sensitive details.

Include the affected commit, deployment mode, reproduction steps, impact, and any suggested mitigation. Remove real note content and credentials from logs or screenshots.

## Deployment trust model

- The browser-only editor processes local files and does not require the Python server.
- `server.py` intentionally has no user authentication. Anyone who can reach it can read and modify the configured graph.
- Internet access requires HTTPS and authentication at a trusted reverse proxy. Keep the application port private.
- Same-origin checks and browser security headers are defense in depth; they are not authentication.
- Graph attachments may contain untrusted files. Unsafe types are downloaded rather than rendered inline, but users should still scan files as appropriate.
- Git is optional, must be installed separately, and may execute behavior configured by the graph repository. Use only repositories and Git configuration you trust.
- Browser IndexedDB and Service Worker caches can contain note and attachment copies. Protect devices and clear site data when access is revoked.

Keep independent backups and test restoration. Do not put credentials, private keys, `.env` files, production graphs, or browser profiles in this repository.
