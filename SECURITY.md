# Security policy

## Supported version

Security fixes target the latest commit on `main`. This project is an early local integration; no independent penetration test or security certification has been completed.

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/ossmalaysia/etric-mcp/security/advisories/new). Do not publish credentials, cookies, tokens, account records, raw authenticated pages, or exploit details in public issues. Provide synthetic reproduction steps, affected commit, and impact. Maintainers will investigate and coordinate disclosure; there is no guaranteed response SLA.

## Trust model

The intended deployment is one trusted OS user, one dedicated browser profile, and trusted local MCP clients. The local worker has the authority of the connected eTRiS account. Use the least-privileged account available and review real business actions locally.

- The worker binds to `127.0.0.1`, uses a random 256-bit bearer token with constant-time comparison, checks Host, validates action/argument schemas, and bounds request bodies/headers and input-reading time.
- Browser-based RPC is rejected. Local forms require the exact expected Origin and short-lived tokens. Forms are protected against framing, do not cache responses, and escape displayed values. No CORS access is enabled.
- Saved credentials use Windows DPAPI CurrentUser. Passwords enter a local form and travel to the encryption helper through stdin; they are not MCP arguments or command-line arguments. Login fields and malformed-input details are excluded from tool responses.
- Browser document navigation is restricted to the portal origin and this worker's exact local origin, including its port. Unrelated loopback services are blocked. Portal subresources are not a general network sandbox.
- Routine operation is headless. Reviewed save/delete operations require a local preview and current form state. Refreshed page references prevent accidental use of outdated controls.
- Website text is untrusted data. Navigation labels and observed routes assist the user, but are not a complete authorization boundary against a malicious assistant or compromised portal. Trusted clients can inspect account data and navigate the portal; do not give unknown clients access to the worker token.

DPAPI does not protect against malware running as the same Windows user, an administrator, a compromised browser/OS, or an untrusted MCP client. JavaScript cannot guarantee complete erasure of plaintext credentials from process memory. This project cannot secure HRD Corp's website, its authentication service, or the LLM provider.

## Local data

Keep `%LOCALAPPDATA%/etric-mcp` private to your OS account. It contains the browser profile, session data, encrypted credentials, and worker token. Custom `ETRIC_DATA_DIR` paths must also have private OS permissions; do not use a shared folder or put runtime data in the repository. Do not expose or forward the worker port through a tunnel, reverse proxy, or LAN interface.

`etric_forget_login` removes the saved credentials and dedicated profile after local review. `npm run stop` stops the worker while retaining them. If credentials leak, change them through the portal, invalidate available sessions, remove exposed local data, and report the incident privately. Removing a file from a new commit does not remove it from Git history.

## Automated coverage

The [CI workflow](https://github.com/ossmalaysia/etric-mcp/blob/main/.github/workflows/ci.yml) runs for pushes, pull requests, manual dispatch, and a weekly schedule without path exclusions:

| Check | Coverage |
| --- | --- |
| Gitleaks | All fetched Git history and a separate snapshot of every tracked file, including docs, fixtures, and configuration. Logs redact detected secrets. |
| CodeQL | JavaScript/TypeScript source and GitHub Actions workflows; extended security queries for JavaScript. Any reported finding fails the pipeline. |
| Dependency integrity | Locked install without lifecycle scripts, vulnerability audit including dev dependencies, registry signature and available attestation verification. Any known vulnerability or verification error fails. |
| Repository policy | Required public project files, documentation links, JSON validity, forbidden runtime-file paths, approved actions pinned to complete commit SHAs. |
| Synthetic regressions | Windows and Linux on Node 22/24; Windows includes real DPAPI tests with dummy credentials. No live portal credentials are available in CI. |

GitHub secret scanning, push protection, Dependabot alerts/security updates, and private vulnerability reporting are enabled separately from workflow files. The protected default branch requires passing `Required checks`, an approving review, resolved conversations, and code-owner review. Administrators are subject to the protection; force pushes and deletion are disabled.

Tools have limits: pattern scanners can miss secrets and account data, not every npm package has provenance, and static analysis cannot prove the absence of vulnerabilities. Ignored local profiles, downloaded dependencies, and live account pages are deliberately not uploaded or included in the source snapshot. Coverage of published files is not a claim that every private local file has been scanned.

## Dependency verification exception prevention

`eventsource-parser` is pinned through an override to `3.1.0`: the previously resolved `3.1.1` failed npm attestation verification on 2026-10-10. The replacement passes registry signatures and available attestations and satisfies the SDK's dependency range. This failure is not proof of compromise. Re-evaluate the override when upstream verification is resolved; do not disable signature auditing to accept an update.

## Release pipeline

Version tags matching `package.json` can produce a runtime ZIP and SHA-256 digest after all tests/security jobs pass. The package uses an exact file allowlist and excludes profiles, credentials, dependencies, and fixtures. It is a GitHub Actions artifact, not an automatic npm publication or remote deployment. Maintainers must review and authorize release tags; no release tag is created by the security setup.
