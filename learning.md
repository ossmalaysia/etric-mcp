# Project learning log

Read the durable lessons and latest relevant entries before starting work. Update this file for every task before handoff. Record evidence and decisions, not credentials, account data, raw pages, or a conversation transcript.

## Durable lessons

### Portal and runtime

- **Verified:** the portal hostname is `etris.hrdcorp.gov.my`, not `etric.hrdcorp.gov.my`.
- A local stdio MCP shim talks to a shared loopback worker. Reuse that worker/browser instead of launching clients against the same persistent profile independently.
- `npm run build` does not reload the running worker. Apply a runtime change with an intentional restart; documentation changes do not need a restart.
- Persistent browser profiles alone do not guarantee retention of session cookies after browser exit. Visibility changes preserve cookies temporarily in memory and restore the application frame.
- Background mode is the default for routine use. Show the browser only for interactive setup, verification, local review, or requested debugging. Ordinary fields can be restored across mode changes; uploads and custom widget state require extra care.

### Local form submission

- **Reproduced and fixed:** `Referrer-Policy: no-referrer` makes native browser form POSTs send `Origin: null`, causing strict origin validation to reject the application's own login/review form.
- Use `strict-origin`: the expected origin survives, and referrer paths/query tokens are not exposed. Keep Host, Origin, content-type, and short-lived token checks intact.
- Test native browser form submission, not just requests with hand-built headers. Both credential and review forms have a regression test.
- Node's `fetch` did not send a custom Host as expected in the original test. Use `node:http` when testing rejection of an invalid Host header.

### eTRiS navigation and page inspection

- The portal uses nested frames and legacy Dojo trees. Anchor-only inspection misses its menu entries.
- Dojo labels expose `role="treeitem"`. The authorized menu store, `continentStore0`, supports traversal through its fetch/label/value APIs. Capture the connected account's tree dynamically.
- **Live-tested path:** Applications → Profile Management → Training Programme → View My Programme. The registration screen was also opened without submitting it.
- Store captured menus only in the worker's memory. Reusable routes retain needed generic navigation parameters and remove session tokens and account/record identifiers.
- Hidden frame documents can expose unrendered text or script source through naive `innerText` reads. Skip hidden frames and exclude script/style/template content from visible text collection.
- Navigation can destroy a frame's execution context before inspection completes. Retry transient reads with a short bound; do not blindly retry writes or authentication.
- An empty/loading document is not evidence of an authenticated session. Wait for a ready page and inspect its state.
- **Live-tested and fixed:** an expired workspace can remain visible without a password field. Recognize the visible session-expiry message, mark login required, and clear cached authorized menus. A successful automatic sign-in must clear the failed-attempt guard so a later expiry can recover; unsuccessful attempts remain guarded.
- **Live-tested and fixed:** programme-number anchors use `onClickColumn` with a view route and `notEditable=Y`. Recognize that exact handler/route instead of treating numeric labels as safe generally. Wait for the selected record's iframe document, not just the desktop's load state, before returning the click result.
- **Live-tested and fixed:** application frames can acquire a programme title or other runtime name. Find the application frame by its owning iframe element's stable ID/name for navigation, menu capture, and visibility restoration. Runtime frame names can contain account data; do not publish or print them in diagnostics.
- Page references are temporary. Reinspect after navigation, filling, visibility changes, or other page updates.

### Popups and write review

- **Live observation:** eTRiS opens its real workspace as a popup during login. Tracking every new window as disposable can close the programme workspace. Protect login/workspace windows, including the `#application` shell and login route, and classify only extra notices as dismissible.
- The programme screen's Close button can return to the menu; it is not a notice dismissal. Only use recognized dismissal controls inside a dialog container for in-page notices.
- Ordinary JavaScript dialogs are dismissed, with only their types recorded. Popup dismissal must not accept save/delete or business confirmations.
- Compare the selected programme/form frame during write review, not the entire desktop. The desktop's session countdown changes and would otherwise invalidate a legitimate review.
- Mode changes invalidate refs. Restore the intended mode and obtain current refs before returning an actionable result.

### Validation and publication

- Synthetic CRUD tests verify browser/form mechanics; they do not prove successful writes on the real eTRiS account.
- Live checks validated authentication, authorized menu capture, background navigation, programme listing, all three standard detail tabs for each visible programme, and opening the registration screen. Actual programme writes, receipts, attachment reads/downloads, search, multi-page pagination, and lifecycle semantics remain pending.
- The source destination is the public `ossmalaysia/etris-mcp` repository, superseding the initial private repository request.
- Runtime credentials/profile/token files live outside the checkout and are ignored defensively. Never copy live values into this log or fixtures.
- Inspect staged files and run redacted Gitleaks before pushing. Prior scans passed, but each new change still needs its publication check.
- OSS scans must be automated and enforced, not described as complete merely because a local secret scan passed. Scan complete fetched history and every tracked file separately, audit vulnerabilities plus registry signatures/available attestations, and scan both source and Actions workflows. CI must never use the live account.
- **Observed:** npm reported an invalid attestation for transitive `eventsource-parser@3.1.1` despite a clean vulnerability audit. A compatible override to `3.1.0` passes registry/attestation verification. This is a verification failure, not proof of compromise; do not suppress the audit to accept it.
- Keep local request validation at the worker boundary as well as MCP schemas. Malformed JSON/schema errors can quote supplied values; return generic errors instead. Browser navigation should allow only the portal and the exact local form origin, not arbitrary loopback ports.
- Workflow YAML parsing is not GitHub expression/context validation. The first hosted bootstrap rejected `runner.temp` at job-level `env`; move it to step-level `env`, and validate workflows with checksum-verified Actionlint locally and in CI.
- CodeQL's extended file-to-HTTP query reports expected local token authentication even when the destination is loopback. Route worker/test requests through one fixed-origin transport with redirects forbidden. Keep a narrow, documented rule/file/sink exception bound to the whole source hash; leave scanner coverage intact and fail on all unreviewed findings. Hosted Linux browser tests need realistic startup budgets and bounded navigation waits.
- Resolve SARIF artifact URIs against their declared source base; raw reports can use absolute file URIs while GitHub's API presents relative paths. Do not broaden a reviewed exception to arbitrary paths. The organization's SonarCloud integration also scans this public repo; a PATH-based Git invocation in the policy script was replaced with fixed standard executable paths.
- Windows hosted runners already provide Edge/Chrome, which the browser adapter prefers. Detect them before downloading the unused Chromium fallback; Linux still installs browser system dependencies. This avoids blocking Windows validation on redundant CDN downloads.

## Task entry template

### YYYY-MM-DD — Task title

- **Objective:** What the user wanted.
- **Observed:** Relevant evidence and current state; mark assumptions explicitly.
- **Process:** Important actions and decisions, including approaches that failed.
- **Outcome:** What changed or was established.
- **Validation:** Checks actually performed and their results. Separate synthetic tests from live checks.
- **Learning:** Reusable rule, or a reference to an existing lesson if nothing new emerged.
- **Next:** Remaining work or explicit limitations; use “None for this task” when appropriate.

## Task history

### 2026-10-10 — Initial local MCP and saved credentials

- **Objective:** Control eTRiS through an LLM, support saved login, and focus on local MCP before remote connectivity.
- **Observed:** The official login page uses `j_username`, `j_password`, and `btnSubmit`. Multiple MCP clients need to share one local browser session.
- **Process:** Built a TypeScript stdio server, shared authenticated loopback worker, Playwright browser session, local credential/review forms, and Windows DPAPI storage. Added page/form primitives and programme tools. Kept runtime data outside the source checkout.
- **Outcome:** Local browser control and encrypted saved login were implemented; the user could connect after the form-origin correction below.
- **Validation:** Initial synthetic tests covered credentials, form CRUD, and protocol behavior. Live programme writes were not performed.
- **Learning:** Separate provider-independent MCP tools from local browser/authentication code. Do not send a password through MCP or claim a clicked action is a verified success.
- **Next:** Validate real programme workflows progressively without unauthorized mutations.

### 2026-10-10 — Fix invalid Origin on local forms

- **Objective:** Fix the user's “Invalid Origin” error after clicking Connect to eTRiS.
- **Observed:** A real browser submission of a synthetic credential form reproduced HTTP 403 under `no-referrer`.
- **Process:** Changed the response policy to `strict-origin` while preserving validation. Added a native-browser regression covering both credential and review forms; restarted the worker and reopened local setup.
- **Outcome:** The user confirmed connection worked. The fix was published in commit `241923d`.
- **Validation:** Six tests passed and the staged secret scan found no leaks.
- **Learning:** Privacy headers can affect Origin on native form navigation. Verify the actual browser request behavior rather than relaxing the origin check.
- **Next:** Preserve this regression when changing local UI/security headers.

### 2026-10-10 — Capture programme links, hide browser, and handle popups

- **Objective:** Test the connected account, capture reusable navigation links, support quiet background operation, and dismiss website popups.
- **Observed:** Conventional link inspection missed the Dojo menu. Live navigation exposed the Training Programme hierarchy. One inspected account returned 53 authorized menu entries; counts and permissions can change.
- **Process:** Expanded frame/control inspection, added dynamic menu capture and named section navigation, made background mode the default, added visibility switching, and implemented notice/window dismissal. Corrected popup classification after recognizing the login workspace as a protected window. Added synthetic regressions for those cases.
- **Outcome:** `etric_links`, `etric_sections`, `etric_open_section`, `etric_browser_visibility`, and `etric_dismiss_popup` were exposed. `etric_program_list` opens View My Programme. Changes were published in commit `b81522e`.
- **Validation:** Eight synthetic tests passed. Live background checks verified saved sign-in, menu capture, programme listing, registration-screen navigation without submission, and continued workspace availability. The final live check had no notice popup. An actual stdio MCP client discovered the new tools and read the connected background session. Gitleaks found no leaks across all three source commits at that time.
- **Learning:** Use authorized menu data rather than guessed routes; protect workspace windows; preserve cookies on mode changes; never confuse fixture CRUD with verified live writes.
- **Next:** Validate detail/search/pagination and account-specific write workflows when authorized.

### 2026-10-10 — Add project objectives and persistent learning instructions

- **Objective:** Add `learning.md`, agent guidance, Claude guidance, and an objective document so future work does not repeat resolved investigations.
- **Observed:** The repository had a README and implementation tests but no project instructions or durable learning log.
- **Process:** Created `AGENTS.md` as the common instruction source, aligned `CLAUDE.md`, recorded current scope and acceptance criteria in `intents.md`, and seeded this log from verified session history. Defined a per-task update template and kept account data out of all four documents.
- **Outcome:** Future tasks must read the objectives/lessons first and update this log before handoff. Documentation-only work is explicitly exempt from unrelated browser restarts and test repetition.
- **Validation:** All relative documentation links resolved, the staged diff check passed, and the redacted Gitleaks scan found no leaks. No browser restart or unrelated test rerun was needed for this documentation-only task.
- **Learning:** Keep objectives, agent instructions, and evidence separate but linked. Store actionable lessons and verification boundaries instead of raw transcripts.
- **Next:** None for this documentation task; remaining implementation acceptance criteria are tracked in `intents.md`.

### 2026-10-10 — Clarify programme tool readiness

- **Objective:** Confirm whether all programme-management tools are working on the real portal.
- **Observed:** The tool handlers show that listing opens the captured View My Programme route, reading snapshots the current page, create/update fill an already-open form, and save/delete click a selected control after review. The live menu exposes a programme cancellation request route, which is not yet mapped to a complete cancellation workflow.
- **Process:** Compared the implementation with the recorded live and synthetic validation evidence. Did not restart the browser or perform any real programme mutation for this status question.
- **Outcome:** Login, background navigation, menu capture, and programme listing are live-verified. Detail navigation, account-specific create/update forms, actual submission outcomes, and deletion/cancellation semantics are not fully validated. The existence of named tools does not establish complete live CRUD support.
- **Validation:** Inspected current handlers, tool descriptions, README, objectives, and prior learning. No implementation change or new runtime test was needed.
- **Learning:** Communicate readiness per workflow. Keep fixture-tested form mechanics separate from verified account-specific business operations.
- **Next:** Inspect and map the remaining real forms and lifecycle operations, then validate writes only against a test account or a specifically authorized operation.

### 2026-10-10 — Test all read tools against the connected account

- **Objective:** Test all read tools first, without creating, changing, or deleting real programmes.
- **Observed:** A cached workspace reported an expired session while status still said login was available. A previous successful auto-login left the retry guard set. Programme links were conservatively routed into local review; clicks could return the old list before the detail iframe loaded. After reading different programmes, the application's runtime frame name changed and returning to the list failed.
- **Process:** Exercised the real stdio MCP client and shared worker with account values held only in memory. Fixed expiry detection/cache invalidation, cleared the retry guard after successful sign-in, recognized only the exact observed view-only programme link, waited for the selected detail document, and located application frames through their iframe elements. Extended synthetic regressions. A renamed-frame fixture also exposed draft restoration matching by unstable runtime names; corrected it to use application-frame identity. Added an opt-in `npm run test:read` harness with counts-only output, fresh references, selected-title matching, and no business writes. Account navigation can expose cached menu catalogs without a currently loaded Dojo menu; validate visible links separately from the authorized section catalog.
- **Outcome:** All five registered read-only tools passed, together with section capture/opening, observed-URL navigation, and view-only clicks. The final run read four visible programmes and all 12 Programme Information, Course / Content Outline, and Trainer List tabs, captured a 53-entry authorized catalog, and returned to View My Programme in background mode. These counts are account-specific.
- **Validation:** Final `npm test`: eight tests passed. Final `npm run test:read`: nine tools/helpers passed, four programme detail reads, 12 detail tabs, background mode, zero programme writes. Documentation file links and the staged diff check passed; a redacted Gitleaks scan of the staged publication found no leaks. The destination was checked as the public OSS Malaysia repository; runtime account data was excluded.
- **Learning:** Confirm actual detail content and selected-record identity, rather than accepting any returned snapshot as a successful read. Application window/frame names are mutable and potentially private. The live harness must wait through initial loading and report generic failures without logging raw tool results.
- **Next:** Search, multi-page pagination, attachment reads/downloads, and real create/update/submission/cancellation remain unverified. None of these was promoted to a verified workflow by this read test.

### 2026-10-10 — Establish secure OSS maintenance and CI

- **Objective:** Verify OSS CI/CD and complete-public-source security coverage, then strengthen security.
- **Observed:** The repository had a license and local tests but no hosted workflows or community/security guidance. GitHub secret scanning, push protection, and Dependabot security updates were disabled. The vulnerability audit was clean, but npm signature auditing rejected a transitive dependency's attestation. Only one repository collaborator was available for review.
- **Process:** Enabled GitHub secret scanning/push protection, Dependabot alerts/security updates, and private vulnerability reporting. Added pinned official Actions with minimal permissions and no persisted checkout credentials, Windows/Linux Node 22/24 fixture tests, full-history and all-tracked-file Gitleaks scans, dependency integrity checks, source/workflow CodeQL analysis with a findings gate, weekly checks, and an aggregate merge gate. Added Dependabot config, code ownership, contribution/conduct/security policies, issue/PR templates, and an allowlisted tag package with SHA-256 output. Pinned direct dependencies and selected a compatible parser version with passing attestations. Added strict worker schemas, timing-safe token comparison, framing protections, request limits, and exact-origin navigation restrictions.
- **Outcome:** Hosted CI passes the complete Windows/Linux Node 22/24 matrix, dependency integrity, full-history/all-file secret scanning, source/workflow CodeQL gates, and workflow/repository policy checks. SonarCloud also passes. GitHub secret scanning/push protection, dependency security updates, and private reporting are enabled. The default-branch policy requires successful app-bound checks, an independent code-owner approval, resolved conversations, and administrator enforcement; the initial CI bootstrap is merged before activating that policy. The stricter review default was explained because the repository has one maintainer. Release packaging is configured without creating a tag or publishing to npm.
- **Validation:** Final local `npm test`: eleven tests passed. Dependency audit: zero known vulnerabilities; 102 registry signatures and 15 available attestations verified. The live MCP read check still passed all nine tools/helpers, four programmes, and 12 detail tabs with zero writes in background mode. Repository policy/link/JSON checks and local full-history, staged, and complete-public-snapshot Gitleaks scans passed; runtime packaging used the explicit public-file allowlist. Hosted push run [37984191298](https://github.com/ossmalaysia/etris-mcp/actions/runs/37984191298) and PR run [37984196938](https://github.com/ossmalaysia/etris-mcp/actions/runs/37984196938) passed every required job. Windows runs all eleven tests; Linux skips only DPAPI. CodeQL has one documented, source-hash-bound expected authentication flow, no unreviewed findings, and no open alerts on the tested PR. The alert is triaged as a false positive; no source/test directory or query was excluded. SonarCloud's security gate passed after replacing the PATH-dependent policy-script Git invocation. SARIF gate checks cover clean, rejected, and narrowly reviewed results; workflow lint passed. Final default-branch activation is checked through GitHub's API during handoff after the bootstrap merge.
- **Learning:** A vulnerability audit alone does not verify package provenance. Security policy must describe actual trust limits and coverage; local scans do not establish hosted CI or independent security certification. Mandatory review with a sole maintainer needs an explicit maintenance decision rather than pretending an independent reviewer exists.
- **Next:** Add another eligible code owner for independent review of PRs opened under the maintainer's own account. A real release tag run, independent penetration testing, and real programme writes remain unverified. Passing automation is not an absolute security guarantee.

### 2026-10-10 — Confirm current operational status

- **Objective:** Answer whether the local MCP is working now using fresh runtime evidence.
- **Observed:** The existing background session required login; encrypted saved credentials remained available. Latest default-branch CI run [38009574836](https://github.com/ossmalaysia/etris-mcp/actions/runs/38009574836) completed successfully.
- **Process:** Reused the shared worker and connected an actual stdio MCP client. Called login once, then session status and programme listing, reporting only status and counts.
- **Outcome:** Saved automatic sign-in succeeded, the session was authenticated without loading, and the programme list returned four visible rows in background mode. No programme writes occurred.
- **Validation:** All three MCP calls returned without tool errors. Documentation diff and repository policy checks passed. Prior all-read verification remains applicable; this status check did not repeat every detail tab.
- **Learning:** Previously verified read workflows and a current authenticated session are separate evidence. A single saved-login recovery can restore an expired session without restarting the browser.
- **Next:** Real create/update/submission/cancellation and the other previously listed unverified workflows still require account-specific validation. This local documentation update awaits the normal protected-branch PR process.

### 2026-10-10 — Correct the public repository name

- **Objective:** Apply the user's corrected repository name, `ossmalaysia/etris-mcp`.
- **Observed:** GitHub and the local origin still used the misspelled repository name. The desired destination was available and the current account had repository administration permission.
- **Process:** Renamed the existing GitHub repository, updated the local origin, and replaced repository links in public documentation, package repository metadata, and the private-reporting issue link. Kept local checkout/runtime paths valid so existing clients and saved credentials continue working.
- **Outcome:** The public repository is now [ossmalaysia/etris-mcp](https://github.com/ossmalaysia/etris-mcp). Link corrections are prepared on a feature branch for the required PR review.
- **Validation:** GitHub returned the corrected name and public visibility. Main retained both required checks, one code-owner approval, and administrator enforcement. Repository policy checks, diff checks, and the redacted staged secret scan passed before publication.
- **Learning:** Correct a repository name by renaming the existing repository so its history and protections persist. Repository naming and an already-configured local data directory are separate concerns.
- **Next:** Merge the link-correction PR after required checks and independent code-owner approval; do not bypass main protection.

### 2026-10-10 — Clarify overall readiness after the repository rename

- **Objective:** Confirm whether every requested capability is complete.
- **Observed:** The current session is authenticated, ready, and in background mode with saved credentials available. Main CI and every reported PR check passed; PR #2 remains open with independent review required.
- **Process:** Queried current worker status and GitHub check/review state, then compared verified capabilities with the remaining acceptance criteria. No login retry, restart, or programme write was needed.
- **Outcome:** Local login, background navigation, and the previously verified programme reads work. Full live CRUD, uploads, search, pagination, and hosted ChatGPT connectivity are not verified or implemented as complete workflows.
- **Validation:** Worker status returned successfully; GitHub reported successful CI/security checks and a review-required merge state. The documentation diff and repository policy checks passed.
- **Learning:** Passing CI verifies the covered checks; it does not complete untested portal operations or replace independent review.
- **Next:** Validate the remaining account-specific workflows only within authorized scope. This status note is included in the subsequent Claude Desktop documentation publication.

### 2026-10-10 — Document Claude Desktop configuration

- **Objective:** Add a Windows Claude Desktop setup guide matching the user's Local MCP servers screenshot.
- **Observed:** The README had generic JSON but no Desktop walkthrough. The screenshot showed existing servers and an Edit config button. The local checkout still uses its original directory name, while the public repository name is corrected.
- **Process:** Checked official MCP/Claude guidance, expanded the README with build prerequisites, configuration merging, restart and connector checks, login/background behavior, and troubleshooting. Aligned the example's display label to `etris`, while retaining existing tool names and valid local paths. Did not modify the user's Desktop config or publish the screenshot.
- **Outcome:** A copyable Windows configuration and guided read-only first request are documented. Existing servers and local credential entry are explicitly preserved. The open documentation PR includes both corrected repository links and the Desktop guide.
- **Validation:** README JSON parses and matches `mcp-config.example.json`. An actual stdio client using the documented config connected and discovered all 20 tools, including every named tool in the walkthrough. Repository policy/link checks, diff checks, and the redacted staged Gitleaks scan passed. No unrelated browser restart or live programme write was needed.
- **Learning:** A Claude Desktop guide must explain merging entries, full application restart, absolute Node/build paths, connector permissions, and the difference between server display labels and tool names. Changing startup mode does not alter an already-running shared worker.
- **Next:** The source changes require normal protected-branch CI and independent code-owner review. End-to-end setup in the user's Claude Desktop UI was not exercised by the stdio configuration check.

### 2026-10-10 — Check security evidence and attempt the requested merge

- **Objective:** Merge PR #2 and verify whether published secrets or security findings were detected.
- **Observed:** All latest PR checks passed at commit `6be88b1`, including full-file/history secret scans, dependency integrity, CodeQL, and SonarCloud. GitHub returned zero open secret-scanning, Dependabot, and code-scanning alerts. Main requires one code-owner approval, latest-push approval, successful checks, and administrator enforcement. The sole listed owner is also the PR author; no independent review exists.
- **Process:** Checked the exact PR head, change summary, protection settings, and alerts; scanned all local Git history with redacted Gitleaks output. Attempted a normal squash merge bound to the checked head, without an administrator bypass.
- **Outcome:** GitHub rejected the merge because branch policy prohibits it. PR #2 remains open. No secrets were detected by the history scan; passing scanners and empty alert lists do not establish an absolute absence of vulnerabilities or sensitive data.
- **Validation:** Gitleaks scanned 15 commits and reported no leaks. The checked local head matches the PR head. Documentation diff/repository policy checks passed. No protection was changed and no programme write occurred.
- **Learning:** Merge authorization does not create the independent review required by the existing protected branch. A scanner's no-findings result is evidence within its coverage, not a universal security guarantee.
- **Next:** Obtain an eligible independent code-owner review before retrying the merge. This note is included with the subsequent requested Claude instruction update; prior check results apply to the previously tested head.

### 2026-10-10 — Expand Claude-compatible project instructions

- **Objective:** Provide a Claude instruction file with practical local MCP setup and operating guidance.
- **Observed:** Root `CLAUDE.md` already existed but only described shared objectives/defaults. Claude Code's documented filename is uppercase; a second case-only filename is unnecessary on Windows. The installed Claude Code version is 2.1.296.
- **Process:** Expanded the existing file, imported `AGENTS.md` using Claude's documented import syntax, and added local registration/run commands, verification commands, Desktop guidance, tool sequencing, credential boundaries, development checks, and verified-workflow limits. Added a README link. Consulted official Claude memory/MCP docs and checked the local CLI help without changing personal Claude configuration.
- **Outcome:** Claude Code receives shared project rules plus executable setup guidance. Desktop users are directed to JSON configuration and explicit instruction attachment instead of assuming automatic repository-file loading. The updated documentation is part of PR #2.
- **Validation:** The shared import resolves, every documented npm script exists, every named tool matches the implementation, and the instruction file stays below 200 lines. CLI help supports the documented local scope, environment, and stdio options. Repository/link checks, diff checks, and the redacted staged secret scan passed. No new Claude model session, browser restart, or live programme write was performed.
- **Learning:** Keep Claude-specific startup guidance in `CLAUDE.md`, import common agent rules, and distinguish instruction loading from MCP registration. Avoid duplicate files that differ only in capitalization.
- **Next:** Updated PR checks and independent code-owner review are required before merge. Existing portal write-validation limitations remain.

### 2026-10-10 — Add macOS native support

- **Objective:** Support Mac users with saved login, local MCP operation, and Claude setup.
- **Observed:** Playwright browser channels and stdio transport were cross-platform, but persistence, form copy, runtime paths, and setup instructions assumed Windows. The active Windows worker need not restart to test the new Mac backend.
- **Process:** Added a macOS Keychain backend through the fixed Apple security utility, with credential data sent only through stdin and separate hashed items per data directory. Added generic native errors, bounded subprocess output/time, no plaintext fallback, private POSIX directories, platform form copy, macOS Desktop/Code examples, and package allowlist entries. Expanded hosted CI to Apple Silicon and Intel macOS with native vault tests in isolated synthetic keychains. Retained the Windows DPAPI path and credential format.
- **Outcome:** macOS implementation and setup documentation are prepared on PR #2. Windows compatibility is retained; Linux remains session-only. Native macOS CI and real Mac portal verification have separate readiness criteria.
- **Validation:** Local Windows `npm test` passed all 13 regressions, including Keychain argument/stdin isolation, injection rejection, failure handling, and real DPAPI round trips. Repository/link/JSON checks, workflow lint, diff checks, and allowlisted packaging passed. Redacted staged secret scanning passed before publication. Hosted macOS execution is pending at this entry; a Windows test cannot certify a native Keychain operation.
- **Learning:** Use platform-native storage rather than plaintext cross-platform files. security interactive mode accepts stdin commands; base64 avoids parser metacharacters and keeps secrets out of argv. Trusting Apple's security utility still allows access within the same OS-user boundary; document that limitation. CI may use only isolated dummy keychain items and must clean them up.
- **Next:** Check all eight OS/architecture/Node CI combinations and source/security jobs; address failures before calling macOS native checks verified. Demonstrate the portal workflow on an authorized Mac separately. Required code-owner review still applies before merge.

### 2026-10-10 — Add the requested pending-feature roadmap

- **Objective:** Create `rodmap.md` to inform users which features remain unimplemented or unverified.
- **Observed:** Remaining acceptance criteria were in `intents.md`, but there was no dedicated feature-status/prioritization document. The user requested the filename `rodmap.md`.
- **Process:** Added verified capabilities, macOS/publication work in progress, a prioritized pending-feature table with completion evidence, and explicitly future scope. Linked it from the README, agent/Claude guidance, and objectives; included it in the public package allowlist and repository policy.
- **Outcome:** `rodmap.md` distinguishes existing generic form primitives from complete live CRUD, current-page reads from pagination, and automated tests from real Mac/account validation. Future hosted connectivity is not presented as implemented.
- **Validation:** Document links and JSON/policy checks passed; the package allowlist includes the roadmap. Publication diff/secret checks passed. No private account data, secrets, record identifiers, or promised delivery dates were added.
- **Learning:** A useful roadmap states present behavior and observable completion criteria, not just tool names. Preserve the explicitly requested filename and keep it aligned with evidence as implementation advances.
- **Next:** Update macOS status after hosted native checks. Implement and validate pending features only within the authorized account/action scope.

### 2026-10-10 — Fix native Keychain updates found by macOS CI

- **Objective:** Resolve the native macOS regression rather than skipping credential coverage.
- **Observed:** Both macOS architectures created/read a dummy Keychain item successfully, but updating it timed out. Windows/Linux and all source/security jobs passed on that implementation head. The failure pointed specifically to the native update call, not browser startup.
- **Process:** Checked Apple's SecurityTool source. Applying a trusted-app ACL during an existing-item update calls an access-change API that prompts for authorization. Changed the helper to set the trusted application on creation only and preserve existing ACLs for updates. Added a regression assertion for the emitted update command.
- **Outcome:** The update path no longer requests an unnecessary ACL change; it retains the existing trusted-helper restriction. No broad access grant or plaintext fallback was introduced.
- **Validation:** Local regression and publication checks are repeated for the changed code; native macOS CI must verify the update behavior on both architectures before marking the feature complete.
- **Learning:** Passing an identical `-T` option during a security-tool update still performs an ACL mutation. Preserve access controls unless an explicit access-policy change is intended. Native platform tests exposed behavior the subprocess fixture could not prove.
- **Next:** Check the replacement hosted run, then update roadmap readiness from its actual result.
