# Contributing

Read [AGENTS.md](AGENTS.md), [intents.md](intents.md), and the relevant lessons in [learning.md](learning.md). Use a feature branch and pull request. The default branch requires CI/security checks and an approving code-owner review; do not bypass those checks or force-push `main`.

## Setup and validation

Use Node.js 22 or later:

```powershell
npm ci --ignore-scripts
npx --no-install playwright install chromium
npm test
npm run audit
npm run check:repo
```

On Linux, install browser system dependencies with `npx --no-install playwright install --with-deps chromium` and run `xvfb-run --auto-servernum npm test` because synthetic visibility tests show a browser. DPAPI tests run only on Windows. CI tests both OSes on Node 22 and 24.

Tests use synthetic pages and dummy credentials. `npm run test:read` is a separate opt-in live check against your own authorized account; never run it in CI or provide portal secrets to Actions. Live reads do not authorize programme mutations.

## Pull requests

Describe the problem and resulting behavior, include relevant validation, and explain security effects for changes to credentials, local endpoints, browser access, dependencies, or workflows. Update the learning log and objectives when evidence changes. Stage new files before `npm run check:repo` so the tracked-file checks include them. Run a redacted Gitleaks scan locally before publishing; CI also scans complete fetched history and every tracked file.

Do not include real usernames/passwords, worker tokens, profiles, session cookies, programme identifiers, screenshots of private data, or raw portal output in code, fixtures, documentation, issues, or PRs. Use generic examples and synthetic values.

Keep dependencies locked, installs free of lifecycle scripts, and workflow actions pinned to full SHAs. Dependabot proposes updates; reviewers must inspect them and let all checks pass. Never disable scans or add a broad allowlist merely to make CI green. The temporary parser override is explained in [SECURITY.md](SECURITY.md).

Security vulnerabilities belong in [private reporting](https://github.com/ossmalaysia/etric-mcp/security/advisories/new). Ordinary bugs can use the public issue template with redacted information. Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
