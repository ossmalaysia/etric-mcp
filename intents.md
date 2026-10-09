# Project intent and objectives

## User outcome

Allow an authorized user to operate HRD Corp eTRiS through an MCP-compatible assistant instead of repeatedly navigating the difficult website manually.

## Product objectives

1. **Local MCP first.** Run on the user's computer and support local stdio configuration. Keep tool behavior independent of the LLM provider.
2. **Smooth login.** Collect credentials through a local setup form, optionally save them encrypted, autofill future logins, optionally sign in automatically, and reuse an available session.
3. **Quiet routine operation.** Use background/headless mode by default, with an explicit option to show the browser when the user needs to interact.
4. **Reliable navigation.** Capture the connected account's authorized links and menu hierarchy, including legacy frames and Dojo controls; expose named section-opening tools.
5. **Programme management.** Support listing and reading programmes, preparing create/update forms, and reviewed save/delete actions. Verify outcomes against the website.
6. **Popup handling.** Dismiss notices and extra website windows while preserving the main workspace and programme screen.
7. **No published secrets.** Keep all real credentials, sessions, tokens, and account/programme records outside the public repository and development notes.
8. **Persistent project knowledge.** Maintain `learning.md` after every task and consistent instructions in `AGENTS.md` and `CLAUDE.md` so subsequent work reuses prior evidence.

## Repository and platform

- Repository: **https://github.com/ossmalaysia/etric-mcp**.
- Visibility: **public**. This supersedes the earlier private `anchorsprint` request.
- Portal: **https://etris.hrdcorp.gov.my/DigiGov/login.jsp**.
- Initial platform: Windows, Node.js, TypeScript, Playwright, and Windows DPAPI for saved credentials.
- Connection: local stdio MCP shim to a shared worker bound to `127.0.0.1`.
- Routine browser mode: `background`; interactive alternative: `visible`.

## Verified capabilities as of 2026-10-10

- Local MCP tool discovery and request validation.
- Local credential form submission, encrypted credential storage, saved autofill, and automatic sign-in.
- Authenticated background navigation and authorized menu capture.
- All five read-only tools and four navigation helpers passed an actual stdio MCP client check: 53 authorized menu entries, four visible programmes, and all 12 detail tabs, with no programme writes. These counts describe one connected account, not a fixed capacity.
- Programme detail links load without local write review when the observed route is explicitly view-only. The selected course title is checked against the resulting detail page by the live validation script.
- Expired-workspace detection, cached-menu invalidation on logout/expiry, delayed detail navigation, and navigation through application frames with changing runtime names have regression coverage.
- Opening **Applications → Profile Management → Training Programme → View My Programme** and the registration screen without submitting forms.
- Synthetic tests for form CRUD, fresh references, hidden-frame handling, popup dismissal, workspace protection, visibility changes, and session-cookie retention.
- Eight automated tests passed at the most recent behavior update. The full source history passed a redacted Gitleaks scan.

These are historical verification results, not a substitute for checking the current implementation and session.

## Remaining acceptance criteria

- Validate account-specific programme create/update fields and required attachments using an appropriate test account or a specifically authorized real operation.
- Verify actual save/submission receipts and failure states before describing live writes as complete.
- Determine whether the portal exposes deletion, cancellation, or another programme lifecycle operation; expose the actual supported behavior rather than assuming they are interchangeable.
- Validate search, multi-page pagination, attachment reads/downloads, and further notice types as those workflows are implemented. Detail navigation and the three standard detail tabs are live-verified for the current visible records.
- Keep background operation and session recovery reliable as those workflows grow.

## Scope boundaries

Remote hosting, hosted ChatGPT connectivity, multi-user service deployment, scheduled tasks, and provider-specific application UIs are future work unless the user requests them. Real programme mutations are not part of a read-only navigation test. CAPTCHA and OTP remain user interactions.

## Change policy

Update this file when a user instruction changes the objective or scope, or when evidence changes a capability's verification status. Record the reason and result in `learning.md`. Do not promote synthetic test results into claims of verified live programme writes.
