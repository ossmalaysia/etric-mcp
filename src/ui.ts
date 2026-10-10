export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
body{font:16px/1.6 system-ui;background:#f3f6fb;color:#182b42;margin:0;padding:36px 20px}main{max-width:680px;margin:auto;background:white;padding:32px;border-radius:16px;box-shadow:0 12px 50px #182b4214}h1{font-size:25px;margin-top:0}label{display:block;margin:18px 0 5px}input[type=text],input[type=password]{box-sizing:border-box;width:100%;padding:12px;border:1px solid #9aaabb;border-radius:8px;font:inherit}button{margin:16px 8px 0 0;background:#155caa;color:white;border:0;border-radius:8px;padding:12px 18px;font:inherit;cursor:pointer}.secondary{background:#e9eef5;color:#182b42}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f6fb;padding:16px;max-height:420px;overflow:auto}small{color:#546779}a{color:#155caa}</style><main>${content}</main></html>`;
}

export function credentialPage(token: string): string {
  const storage = process.platform === 'darwin' ? 'macOS Keychain' : process.platform === 'win32' ? 'Windows DPAPI' : undefined;
  return page('eTRiS saved login', `<h1>Connect your eTRiS account</h1><p>Enter your details once on this computer. They go directly to the local server and stay out of the AI conversation.</p><form method="post" action="/credentials"><input type="hidden" name="token" value="${escapeHtml(token)}"><label for="username">Username / MyCoID</label><input id="username" name="username" type="text" maxlength="100" autocomplete="username" required><label for="password">Password</label><input id="password" name="password" type="password" maxlength="50" autocomplete="off" required><label><input type="checkbox" name="save" value="yes" ${storage ? 'checked' : 'disabled'}> Remember my login on this OS account</label><label><input type="checkbox" name="autoSignIn" value="yes" checked> Sign in automatically</label><button>Connect to eTRiS</button></form><p><small>${storage ? `Saved credentials are protected using ${storage}.` : 'Saved login is available on Windows and macOS; use session-only login here.'} Complete any CAPTCHA or OTP in the eTRiS tab. To sign in manually without this form, switch to the eTRiS tab.</small></p>`);
}

export function reviewPage(token: string, action: string, details: string): string {
  return page('Review eTRiS action', `<h1>Review ${escapeHtml(action)}</h1><p>The assistant requested this action on the current eTRiS page. Check the record and form values below.</p><pre>${escapeHtml(details)}</pre><form method="post" action="/decision"><input type="hidden" name="token" value="${escapeHtml(token)}"><button name="decision" value="approve">Approve this action</button><button class="secondary" name="decision" value="reject">Cancel</button></form>`);
}
