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
- Page references are temporary. Reinspect after navigation, filling, visibility changes, or other page updates.

### Popups and write review

- **Live observation:** eTRiS opens its real workspace as a popup during login. Tracking every new window as disposable can close the programme workspace. Protect login/workspace windows, including the `#application` shell and login route, and classify only extra notices as dismissible.
- The programme screen's Close button can return to the menu; it is not a notice dismissal. Only use recognized dismissal controls inside a dialog container for in-page notices.
- Ordinary JavaScript dialogs are dismissed, with only their types recorded. Popup dismissal must not accept save/delete or business confirmations.
- Compare the selected programme/form frame during write review, not the entire desktop. The desktop's session countdown changes and would otherwise invalidate a legitimate review.
- Mode changes invalidate refs. Restore the intended mode and obtain current refs before returning an actionable result.

### Validation and publication

- Synthetic CRUD tests verify browser/form mechanics; they do not prove successful writes on the real eTRiS account.
- Live checks so far validated authentication, authorized menu capture, background navigation, programme listing, and opening the registration screen. Actual programme writes, receipts, attachments, pagination, and lifecycle semantics remain pending.
- The source destination is the public `ossmalaysia/etric-mcp` repository, superseding the initial private repository request.
- Runtime credentials/profile/token files live outside the checkout and are ignored defensively. Never copy live values into this log or fixtures.
- Inspect staged files and run redacted Gitleaks before pushing. Prior scans passed, but each new change still needs its publication check.

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
