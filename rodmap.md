# eTRiS MCP roadmap

Feature status as of 2026-10-10. A registered tool or passing fixture test does not mean the corresponding business operation is verified on the real portal. Follow [intents.md](intents.md) for acceptance criteria and [learning.md](learning.md) for evidence. No delivery dates are promised.

## Available and verified

- Local stdio MCP discovery and request validation.
- Windows saved login with DPAPI, automatic sign-in, and session recovery.
- Background browsing, visibility switching, authorized menu discovery, and notice handling with protected workspace windows.
- Live Windows programme listing and reads of the three standard detail tabs for each visible record. The check covered the current results page, not every account or every result page.
- CI tests, complete-public-file/history secret scans, dependency integrity checks, source/workflow analysis, and protected-main review requirements.
- Claude Desktop/Claude Code setup documentation and root `CLAUDE.md` project instructions. UI setup is not independently verified by stdio client tests.

## In progress

| Work | Status | Completion evidence needed |
| --- | --- | --- |
| macOS saved login and browser support | Keychain backend, platform data directory, native fixture tests, and Apple Silicon/Intel CI being added | Both macOS architectures pass browser and native Keychain tests; real macOS portal login remains a separate manual check. |
| macOS Claude setup | Terminal commands, Desktop JSON example, and Keychain instructions added | Config examples parse; actual paths substituted; connection demonstrated in the user's Mac client. |
| Pending source publication | Changes are on a PR branch | Required CI checks and an independent code-owner approval before merging to main. |

## Next implementation and validation

| Priority | Pending feature | Current state | Done when |
| --- | --- | --- | --- |
| High | Search/filter programmes | No complete verified workflow | Observed controls mapped; selected filters and returned records verified, including empty/error states. |
| High | Multi-page results | Listing reads the current page only | Page traversal, boundaries, counts, and duplicate handling verified. |
| High | Programme creation | Generic form preparation exists; account-specific flow unverified | Required fields/widgets mapped, validation errors handled, and a specifically authorized test submission verified by its receipt. |
| High | Programme editing | Generic field preparation exists; live updates unverified | Correct record identity, editable fields, review binding, and actual persisted results verified. |
| High | Save/submit outcomes | Locally reviewed action-click primitive exists | Portal confirmation/receipt and failure states distinguished; ambiguous outcomes never reported as success or automatically retried. |
| High | Cancellation/deletion lifecycle | Cancellation is present in the observed menu; full workflow unverified | Actual permitted lifecycle operation mapped and reviewed; cancellation is not mislabeled as deletion. |
| Medium | Attachment reads/downloads | Not verified | Allowed files and destination handling mapped without exposing credentials, session tokens, or account data in public output. |
| Medium | Attachment uploads | Not implemented as a complete workflow | Required uploads/custom widgets and review state verified with synthetic or authorized test records. |
| Medium | Additional notice/session scenarios | Known notices/expiry have coverage | Further observed notice types and recovery states handled while preserving the workspace and unsaved state. |
| Medium | macOS live-account check | Native fixtures are separate from real portal validation | Authorized Mac login, background list/detail navigation, visibility changes, and local review demonstrated. |
| Medium | Release validation | Allowlisted tag package configured | A reviewed release tag produces a checked artifact and checksum; no account data included. |

Real create/update/submission/cancellation tests require an appropriate test account or a specifically authorized operation. Read-only tests never authorize real programme writes.

## Future scope

- Remote MCP connectivity for hosted clients, including ChatGPT web, with a separate authentication/access design.
- Multi-user hosting, scheduled actions, and provider-specific integrations.
- A packaged desktop extension/installer if distribution needs justify it.
- Independent penetration testing and external security review; automated scans are not a security certification.

These are candidate directions, not claims of implemented features. Update this file whenever scope or verified readiness changes; keep secrets and private record identifiers out of it.
