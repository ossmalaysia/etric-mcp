# eTRiS local MCP

A local MCP server for navigating HRD Corp eTRiS in a browser that runs in the background during routine use. The user signs in locally; an MCP-compatible assistant can inspect pages, navigate menus, read program tables, prepare program forms, and request save/delete actions.

[![CI](https://github.com/ossmalaysia/etris-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/ossmalaysia/etris-mcp/actions/workflows/ci.yml)

**Status:** local browser integration. All five read-only MCP tools and four navigation helpers passed a live account check on 2026-10-10: authorized menu capture, programme listing, and all three detail tabs for each visible programme. `etric_sections` captures the current account's authorized menu routes dynamically; `etric_open_section` opens a captured route, and `etric_program_list` opens View My Programme automatically. Form writes, uploads, search, multi-page pagination, and final submission receipts still need account-specific validation. These tools do not provide a direct program database API.

## Requirements

- Windows for encrypted saved passwords; manual login also works without password storage.
- Node.js 22 or later.
- Microsoft Edge or Chrome. If neither is available, install Chromium with `npx playwright install chromium`.
- An authorized eTRiS account.

## Install and open login

```powershell
npm ci --ignore-scripts
npm run build
npm run login
```

This opens a dedicated browser window. On first use, a local setup form asks for your username and password. Leave **Remember my login** and **Sign in automatically** checked for the smoothest flow, then click **Connect to eTRiS**. The server saves encrypted credentials, fills the official login page, and clicks Login. CAPTCHA and OTP are completed manually. You can uncheck either option, or switch to the eTRiS tab to log in manually.

To update saved credentials or change the automatic sign-in preference:

```powershell
npm run save-login
```

A local form opens in the browser. Future `etric_login` calls reuse an available browser session, or fill saved credentials and sign in according to your saved preference. If an automatic attempt leaves you on the login page, the worker stops automatic retries. Update the credentials locally or complete verification yourself.

## Configure Claude Desktop on Windows

Use **Settings → Developer → Local MCP servers → Edit config**, as shown on the Local MCP servers screen. This project connects through a local stdio process.

### 1. Prepare the local server

In PowerShell, run these commands from your checkout:

```powershell
Set-Location D:\dev\etric-mcp
node --version
npm ci --ignore-scripts
npm run build
Test-Path .\dist\index.js
```

Node must be version 22 or later, and `Test-Path` should return `True`. If you already installed and built the server, skip the install/build commands. The GitHub repository is named `etris-mcp`; the existing local checkout in this example is still `D:\dev\etric-mcp`. Substitute your actual checkout path if different.

### 2. Add the server to Claude's config

Click **Edit config**. Open `claude_desktop_config.json` in a text editor if the button opens its folder. The usual Windows location is `%APPDATA%\Claude\claude_desktop_config.json`; use the location opened by your installed app.

If the config is empty, use the complete example below. If it already contains servers, add only the `etris` entry inside the existing `mcpServers` object, keeping the other entries and adding a comma between entries. Leave extension-managed servers such as Filesystem in place.

```json
{
  "mcpServers": {
    "etris": {
      "command": "node",
      "args": ["D:/dev/etric-mcp/dist/index.js"],
      "env": { "ETRIC_BROWSER_MODE": "background" }
    }
  }
}
```

The same complete example is in [mcp-config.example.json](mcp-config.example.json). The `args` path must point to the built `dist/index.js`, not the source TypeScript file. Forward slashes work in Windows JSON paths; backslashes must be doubled. Keep usernames and passwords out of this file.

### 3. Restart and check the connection

Save the config, fully quit Claude Desktop, and reopen it. Closing only its window may leave it running; use **Quit** from the system-tray icon if necessary. Return to **Settings → Developer → Local MCP servers** and select `etris`. Check that it is running; use **View logs** if it fails.

In a new conversation, open **+ → Connectors → Manage connectors** and check that the eTRiS tools are available/enabled. Labels may vary with the installed Claude version. Ask:

> Use the etris MCP to check my eTRiS session status. If login is required, use etric_login, then list my programmes. Do not create, update, submit, or cancel anything.

The configured server label is `etris`; the existing tool names still begin with `etric_`, including `etric_session_status`, `etric_login`, and `etric_program_list`. Allow the relevant tool calls when Claude prompts you.

### 4. Set up saved login and background operation

On first login, a local browser form opens. Enter your credentials there and select **Remember my login** and **Sign in automatically**. Credentials are encrypted for your Windows user with DPAPI. Complete any CAPTCHA/OTP locally. Future login calls reuse the session or the saved login.

Routine operation uses background mode. Setup, verification, and write review can show a window. If a visible worker was already running, ask Claude to call `etric_browser_visibility` with `visible: false` after setup; changing the config alone does not change an existing worker's mode. Use `visible: true` when you need to interact with the browser.

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| `etris` does not appear | Validate the JSON, preserve the existing `mcpServers` object, and fully quit/reopen Claude. |
| Cannot find `node` / `ENOENT` | Run `(Get-Command node).Source` in PowerShell and use that absolute executable path as `command`, with forward slashes or escaped backslashes. |
| Cannot find `dist/index.js` | Check the absolute checkout path and run `npm run build` from that checkout. |
| Browser cannot start | Install Edge/Chrome, or run `npx playwright install chromium` from the checkout. |
| Login needs attention | Ask for `etric_save_login` to update credentials locally, or show the browser to complete verification. Automatic failed sign-ins are not repeatedly retried. |
| Server runs but tools are unavailable | Check the conversation's connector settings and tool permissions. Organization policy may restrict local integrations. |

Use **View logs** on the server's Developer screen to investigate connection failures. Keep diagnostic output private if it contains account data. A running server confirms the connection; live create/update/submission/cancellation, uploads, search, and pagination still require account-specific validation.

The configuration, restart, and connector-check steps follow the [official local MCP connection guide](https://modelcontextprotocol.io/docs/develop/connect-local-servers). See also [Claude's local MCP help](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

## Other local MCP clients

This is a stdio server, usable by clients supporting local MCP processes. Adapt [mcp-config.example.json](mcp-config.example.json) to your client's format. For Claude Code:

```powershell
claude mcp add --transport stdio etris -- node D:/dev/etric-mcp/dist/index.js
```

ChatGPT's hosted web interface cannot spawn this stdio process directly. Remote connection support is outside this local version. Use a client with local MCP support for now.

## Tools

| Tool | Behaviour |
| --- | --- |
| `etric_login` | Reuse the session, open first-time setup, or fill saved credentials and optionally sign in. |
| `etric_save_login` | Open a local credential form; passwords never enter MCP arguments. |
| `etric_forget_login` | Review deletion of saved credentials and clearing the dedicated browser profile. |
| `etric_session_status` | Read current page/login status and saved-password availability. |
| `etric_page` | Read visible text, tables, and controls, including same-origin frames. |
| `etric_links` | Capture links, JavaScript controls, frame routes, and authorized Dojo menu entries. |
| `etric_sections` | Load and capture the full authorized Applications menu. |
| `etric_open_section` | Open a captured section by name or full path without submitting its form. |
| `etric_browser_visibility` | Hide/show the browser with `visible: false` / `true`. |
| `etric_dismiss_popup` | Dismiss an in-page notice or close the newest website popup window. |
| `etric_navigate` | Open an observed URL on the eTRiS HTTPS origin. |
| `etric_click` | Click a fresh control reference. Sensitive or unrecognized actions open local review. |
| `etric_fill` | Fill ordinary fields, select options, or set checkboxes. |
| `etric_program_list` | Open View My Programme and read the current program page/table. |
| `etric_program_read` | Read the currently open program detail page. |
| `etric_program_create` | Fill a currently open new-program form; does not save. |
| `etric_program_update` | Fill a currently open edit form; does not save. |
| `etric_program_save` | Review and click the selected save/submit control. |
| `etric_program_delete` | Review and click the selected delete/remove control. |
| `etric_close_browser` | Close the browser while retaining the saved profile. |

Inspect first and use `snapshotId` and `ref` from that response. Reinspect after each action. For form tools, supply `fields: [{"ref": "...", "value": "..."}]`. Selects use the observed option value; checkboxes use `"true"` or `"false"`.

Program workflow: navigate to Program Management, read the list, open the correct record or Add/New form, inspect fields, prepare changes, then request save/delete. The local review displays the selected action and current page/form values. It expires after two minutes. A changed page invalidates the approval. An action-click result is not proof of success: inspect the returned eTRiS confirmation or validation errors.

## Background operation and popups

Routine automation uses a headless browser by default: there is no browser window to pop up. Saved credentials work in this mode. Set `ETRIC_BROWSER_MODE=visible` for interactive debugging, or call `etric_browser_visibility` with `{"visible": true}` to show it temporarily and `{"visible": false}` to hide it again. Mode changes restart the browser, retain session cookies in memory, and restore the application frame and ordinary field values where possible. Refresh element references after switching modes; finish unsaved edits before switching when a form has custom widget state or uploads.

Initial credential setup and local write reviews open visibly because they require your input. An automatic first login returns to background mode after setup. CAPTCHA/OTP or manual sign-in may require showing the browser.

JavaScript alerts/prompts/confirmations are dismissed automatically during ordinary navigation; only their types are reported, never login messages. For a notice inside the page, call `etric_dismiss_popup` with `{"kind": "notice"}`. It only clicks a recognized dismissal control inside a dialog container, and will not use the programme screen's Close button. Use `{"kind": "window"}` to close the newest separate notice window opened by the website. The main workspace opened during login is protected and excluded from notice windows. No save/delete or business confirmation is accepted by the popup tool.

Captured menu routes exclude session tokens and account/record identifiers. The menu catalog lives only in the local worker's memory; account pages and programme records are never written into source files.

Example prompt:

> Open eTRiS so I can log in. Once I am ready, navigate to Program Management and list the visible programs. Read the page before clicking and do not save any program until I review it locally.

## Local data and credentials

Runtime data is stored outside the source checkout in `%LOCALAPPDATA%/etric-mcp` by default:

- `browser/`: dedicated persistent browser profile and session cookies.
- `credentials.dpapi`: credentials encrypted using Windows DPAPI CurrentUser.
- `worker-token`: random bearer token for the local browser worker.

The password is never included in MCP tool parameters or results. Login pages are omitted from page inspection. The credential form binds only to `127.0.0.1`, validates Host and Origin, and requires a short-lived random token. No screenshots, browser traces, network bodies, or credential logs are collected.

Browser session files and local tokens are sensitive. Keep the data directory private to your operating-system account. DPAPI protects stored credentials at rest; the trusted local worker must decrypt them temporarily to fill the browser. Other software running as the same Windows user is outside this isolation boundary. Navigation classification is conservative label-based UI assistance, not a complete authorization boundary for arbitrary website scripts.

Source control excludes environment files, credentials, runtime profiles, logs, downloads, and generated files. Never place real credentials in examples, tests, issue reports, or screenshots.

Optional environment variables:

| Variable | Default |
| --- | --- |
| `ETRIC_DATA_DIR` | `%LOCALAPPDATA%/etric-mcp` |
| `ETRIC_PORT` | `43127` |
| `ETRIC_BROWSER_MODE` | `background` (`visible` to show the browser) |

All clients sharing one worker must use the same settings. Browser actions are serialized; a second request receives a busy response while another action or local review is in progress. The worker remains running when a stdio client disconnects so your login window can be reused.

Stop the local worker and browser:

```powershell
npm run stop
```

This retains the saved credentials/profile. Use `etric_forget_login` to remove them after local review. To diagnose worker startup, run `node dist/index.js --worker` in a terminal after stopping an existing worker.

## Development

Read [AGENTS.md](AGENTS.md) for the shared project workflow, [CLAUDE.md](CLAUDE.md) for Claude's entry point, and [intents.md](intents.md) for objectives and acceptance criteria. Read and update [learning.md](learning.md) for every task so verified lessons and remaining work carry across sessions.

```powershell
npm test
```

Tests use local synthetic pages and temporary dummy credentials. They never create, update, or delete real eTRiS programs.

To repeat the opt-in live read check against your connected account:

```powershell
npm run test:read
```

Start from the authenticated eTRiS desktop in background mode. The check can reuse saved automatic login if the session needs authentication. It tests `etric_session_status`, `etric_page`, `etric_links`, `etric_program_list`, and `etric_program_read`, plus `etric_sections`, `etric_open_section`, `etric_navigate`, and view-only `etric_click` navigation. It matches each visible programme's course title against its detail page, reads Programme Information, Course / Content Outline, and Trainer List, then returns to the list. It tests the current results page only and does not download attachments or submit business forms. Output contains tool names and counts; account records stay in memory.

The 2026-10-10 live check passed with 53 authorized menu entries, four visible programmes, and 12 detail-tab reads, with zero programme writes. Counts depend on the connected account. Eight synthetic regression tests also passed, covering expired-session detection, delayed detail navigation, and application frames whose runtime names change.

This is an independent community project and is not affiliated with HRD Corp.

## OSS maintenance and security

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). GitHub Actions tests Windows/Linux on Node 22/24, scans complete fetched Git history and every tracked file for secrets, scans source and workflows with CodeQL, and verifies dependency vulnerabilities, signatures, and available attestations. Checks run on every push/PR and weekly, including documentation changes. Live account tests are kept out of CI.

The protected default branch requires passing checks and review. Actions use full commit SHAs, minimal token permissions, and no saved checkout credentials. Dependabot proposes dependency/action updates; GitHub secret scanning and push protection help prevent published secrets. Passing scans does not establish a security certification; the trust boundaries and scan limits are documented in the security policy.

The CI bootstrap passed all four Windows/Linux Node 22/24 combinations, with eleven regression tests on Windows and a DPAPI skip on Linux. Source/workflow CodeQL gates have no unreviewed findings; the expected loopback authentication flow has one exact, hash-bound exception documented in the security policy. SonarCloud's security gate also passes. Merges require an approving code owner: your own PR needs another eligible reviewer. Have a trusted maintainer with Write access propose adding their username to `.github/CODEOWNERS`, then review that PR to establish a second code owner.

Matching version tags can build an allowlisted runtime ZIP and SHA-256 digest after the checks pass. The workflow retains it as an Actions artifact; npm publication and remote deployment are outside this local project. No release tag is created automatically.
