# eTRiS local MCP

A local MCP server for navigating HRD Corp eTRiS in a browser that runs in the background during routine use. The user signs in locally; an MCP-compatible assistant can inspect pages, navigate menus, read program tables, prepare program forms, and request save/delete actions.

**Status:** local browser integration. All five read-only MCP tools and four navigation helpers passed a live account check on 2026-10-10: authorized menu capture, programme listing, and all three detail tabs for each visible programme. `etric_sections` captures the current account's authorized menu routes dynamically; `etric_open_section` opens a captured route, and `etric_program_list` opens View My Programme automatically. Form writes, uploads, search, multi-page pagination, and final submission receipts still need account-specific validation. These tools do not provide a direct program database API.

## Requirements

- Windows for encrypted saved passwords; manual login also works without password storage.
- Node.js 22 or later.
- Microsoft Edge or Chrome. If neither is available, install Chromium with `npx playwright install chromium`.
- An authorized eTRiS account.

## Install and open login

```powershell
npm ci
npm run build
npm run login
```

This opens a dedicated browser window. On first use, a local setup form asks for your username and password. Leave **Remember my login** and **Sign in automatically** checked for the smoothest flow, then click **Connect to eTRiS**. The server saves encrypted credentials, fills the official login page, and clicks Login. CAPTCHA and OTP are completed manually. You can uncheck either option, or switch to the eTRiS tab to log in manually.

To update saved credentials or change the automatic sign-in preference:

```powershell
npm run save-login
```

A local form opens in the browser. Future `etric_login` calls reuse an available browser session, or fill saved credentials and sign in according to your saved preference. If an automatic attempt leaves you on the login page, the worker stops automatic retries. Update the credentials locally or complete verification yourself.

## Configure a local MCP client

Use the absolute path of your checkout:

```json
{
  "mcpServers": {
    "etric": {
      "command": "node",
      "args": ["D:/dev/etric-mcp/dist/index.js"],
      "env": { "ETRIC_BROWSER_MODE": "background" }
    }
  }
}
```

This is a stdio server, usable by clients supporting local MCP processes, such as Claude Desktop and Claude Code. Adapt the configuration container to your client's format. For Claude Code:

```powershell
claude mcp add --transport stdio etric -- node D:/dev/etric-mcp/dist/index.js
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
