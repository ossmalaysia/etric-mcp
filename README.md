# eTRiS local MCP

A local MCP server for navigating HRD Corp eTRiS in a visible browser. The user signs in locally; an MCP-compatible assistant can inspect pages, navigate menus, read program tables, prepare program forms, and request save/delete actions.

**Status:** early local implementation. Program tools operate on the currently open page and its observed controls. Account-specific menu paths, form requirements, uploads, pagination, and final success receipts have not yet been validated on a logged-in eTRiS account. These tools do not provide a direct program database API.

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
      "args": ["D:/dev/etric-mcp/dist/index.js"]
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
| `etric_navigate` | Open an observed URL on the eTRiS HTTPS origin. |
| `etric_click` | Click a fresh control reference. Sensitive or unrecognized actions open local review. |
| `etric_fill` | Fill ordinary fields, select options, or set checkboxes. |
| `etric_program_list` | Read the currently visible program page/table. |
| `etric_program_read` | Read the currently open program detail page. |
| `etric_program_create` | Fill a currently open new-program form; does not save. |
| `etric_program_update` | Fill a currently open edit form; does not save. |
| `etric_program_save` | Review and click the selected save/submit control. |
| `etric_program_delete` | Review and click the selected delete/remove control. |
| `etric_close_browser` | Close the browser while retaining the saved profile. |

Inspect first and use `snapshotId` and `ref` from that response. Reinspect after each action. For form tools, supply `fields: [{"ref": "...", "value": "..."}]`. Selects use the observed option value; checkboxes use `"true"` or `"false"`.

Program workflow: navigate to Program Management, read the list, open the correct record or Add/New form, inspect fields, prepare changes, then request save/delete. The local review displays the selected action and current page/form values. It expires after two minutes. A changed page invalidates the approval. An action-click result is not proof of success: inspect the returned eTRiS confirmation or validation errors.

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

All clients sharing one worker must use the same settings. Browser actions are serialized; a second request receives a busy response while another action or local review is in progress. The worker remains running when a stdio client disconnects so your login window can be reused.

Stop the local worker and browser:

```powershell
npm run stop
```

This retains the saved credentials/profile. Use `etric_forget_login` to remove them after local review. To diagnose worker startup, run `node dist/index.js --worker` in a terminal after stopping an existing worker.

## Development

```powershell
npm test
```

Tests use local synthetic pages and temporary dummy credentials. They never create, update, or delete real eTRiS programs.

This is an independent community project and is not affiliated with HRD Corp.
