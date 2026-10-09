import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { BrowserSession, type Field, type View, type Control } from './browser.js';
import { dataDir, port, tokenFile, profileDir, vaultFile, browserMode } from './config.js';
import { Vault } from './vault.js';
import { credentialPage, reviewPage, page } from './ui.js';
import { programmeReadUrl } from './navigation.js';

export const localResponseHeaders = {
  'Cache-Control': 'no-store',
  // Native form POSTs use Origin: null under no-referrer. Preserve the origin
  // for validation while excluding the page path and token from Referer.
  'Referrer-Policy': 'strict-origin',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
};

const dangerousLabel = /\b(save|submit|delete|remove|withdraw|cancel|approve|reject|confirm|register|pay|payment|upload|send|finali[sz]e)\b/i;
const navigationLabel = /\b(program(me)?s?|management|course|training|application|grant|claim|profile|dashboard|home|menu|list|view|detail|search|filter|next|previous|back|add|new|edit|close|expand|collapse)\b/i;
export function needsReview(control: Control): boolean {
  if (dangerousLabel.test(control.label)) return true;
  if (programmeReadUrl(control)) return false;
  if (control.tag === 'a' && control.href && !/^javascript:/i.test(control.href)) return false;
  return !navigationLabel.test(control.label);
}
export function fingerprint(view: View): string {
  return JSON.stringify({ url: view.url, title: view.title, frames: view.frames.map(frame => ({ ...frame, controls: frame.controls.map(({ ref: _ref, ...control }) => control) })) });
}

export async function startWorker(): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const session = new BrowserSession(profileDir, undefined, undefined, browserMode === 'background');
  const vault = new Vault(vaultFile);
  const localOrigin = `http://127.0.0.1:${port}`;
  const credentialTokens = new Map<string, number>();
  const approvals = new Map<string, { resolve: (approved: boolean) => void; details: string; action: string; expires: number }>();
  let busy = false;
  let attemptedAutoLogin = false;

  async function setupCredentials(): Promise<object> {
    for (const [value, expiry] of credentialTokens) if (expiry < Date.now()) credentialTokens.delete(value);
    const secret = randomBytes(32).toString('hex');
    credentialTokens.set(secret, Date.now() + 10 * 60 * 1000);
    await session.openLocal(`${localOrigin}/credentials?token=${secret}`);
    return { status: 'local_credential_form_open', message: 'Enter credentials in the local browser form and click Connect to eTRiS. Saved credentials will be reused. No credentials are accepted through MCP.' };
  }
  async function review(snapshotId: string, ref: string, action: string): Promise<object> {
    const originalMode = session.mode;
    const control = await session.control(snapshotId, ref);
    const previous = session.cachedView(snapshotId);
    const selectedFrame = previous.frames.find(frame => frame.controls.some(item => item.ref === ref))!;
    const index = selectedFrame.controls.findIndex(item => item.ref === ref);
    const secret = randomBytes(32).toString('hex');
    const details = `Action: ${action}\nSelected control: ${control.label}\nPage: ${previous.url}\n\n${selectedFrame.text}\n\nForm values:\n${selectedFrame.controls.filter(item => item.value !== undefined && !['button', 'submit'].includes(item.type)).map(item => `${item.label}: ${item.value}`).join('\n')}`;
    let finish!: (approved: boolean) => void;
    const decision = new Promise<boolean>(resolve => { finish = resolve; });
    const timer = setTimeout(() => { approvals.delete(secret); finish(false); }, 120000);
    approvals.set(secret, { resolve: finish, details, action, expires: Date.now() + 120000 });
    let reviewTab: Awaited<ReturnType<BrowserSession['openLocal']>> | undefined;
    try {
      reviewTab = await session.openLocal(`${localOrigin}/review?token=${secret}`);
      if (!await decision) return { status: 'cancelled', message: 'The local action review was cancelled or expired. Nothing was clicked.' };
      await reviewTab.close(); reviewTab = undefined;
      if (originalMode === 'background') await session.setVisibility(false);
      const current = await session.snapshot();
      const currentFrame = current.frames.find(frame => frame.index === selectedFrame.index);
      if (!currentFrame || fingerprint({ ...previous, frames: [selectedFrame] }) !== fingerprint({ ...current, frames: [currentFrame] })) throw new Error('The eTRiS page changed during review. Inspect it and request the action again.');
      const currentRef = current.frames.find(frame => frame.index === selectedFrame.index)!.controls[index].ref;
      const result = await session.click(current.snapshotId, currentRef, true);
      return { status: 'action_clicked', message: 'Inspect the returned page for eTRiS success or validation errors. This is not a verified success receipt.', requestedAction: action, selectedControl: control.label, page: result };
    } finally { clearTimeout(timer); approvals.delete(secret); await reviewTab?.close().catch(() => {}); if (originalMode === 'background') await session.setVisibility(false); }
  }
  async function execute(action: string, args: Record<string, unknown>): Promise<unknown> {
    const snapshotId = args.snapshotId as string;
    const ref = args.ref as string;
    switch (action) {
      case 'login': {
        await session.openLogin();
        let view = await session.snapshot();
        for (let attempt = 0; view.loading && attempt < 15; attempt++) { await new Promise(resolve => setTimeout(resolve, 200)); view = await session.snapshot(); }
        if (view.loading) return { status: 'page_loading', message: 'The eTRiS page is still loading. Call etric_login again once the page appears.' };
        if (!view.loginRequired) { attemptedAutoLogin = false; return { status: 'session_available', page: view }; }
        const saved = await vault.load();
        if (saved) {
          if (attemptedAutoLogin && saved.autoSignIn !== false) return { status: 'login_needs_attention', message: 'An automatic login was already attempted. Check the browser, or call etric_save_login to update credentials locally. No repeated attempts were made.' };
          attemptedAutoLogin = saved.autoSignIn !== false;
          if (saved.autoSignIn === false && session.mode === 'background') await session.setVisibility(true);
          const result = await session.signIn(saved);
          if (result.status === 'login_submitted') attemptedAutoLogin = false;
          return result;
        }
        return setupCredentials();
      }
      case 'save_login': await session.openLogin(); return setupCredentials();
      case 'forget_login': {
        // Forget both password and browser session, using a concrete local review.
        const secret = randomBytes(32).toString('hex');
        let resolve!: (approved: boolean) => void;
        const decision = new Promise<boolean>(done => { resolve = done; });
        approvals.set(secret, { resolve, details: 'Delete the saved eTRiS password and clear eTRiS browser cookies and storage on this Windows account.', action: 'forget saved login', expires: Date.now() + 120000 });
        const timer = setTimeout(() => { approvals.delete(secret); resolve(false); }, 120000);
        const tab = await session.openLocal(`${localOrigin}/review?token=${secret}`);
        try {
          if (!await decision) return { status: 'cancelled' };
          await vault.forget();
          await session.clearSession();
          return { status: 'forgotten' };
        } finally { clearTimeout(timer); approvals.delete(secret); await tab.close().catch(() => {}); }
      }
      case 'status': return { browser: await session.snapshot(), mode: session.mode, passwordSaved: await vault.exists() };
      case 'page': return session.snapshot();
      case 'links': return session.links();
      case 'sections': return session.sections();
      case 'open_section': return session.openSection(args.name as string);
      case 'browser_mode': return session.setVisibility(args.visible as boolean);
      case 'dismiss_popup': return session.dismissPopup((args.kind as 'notice' | 'window') ?? 'notice', args.snapshotId as string | undefined, args.ref as string | undefined);
      case 'navigate': return session.navigate(args.url as string);
      case 'click': {
        const control = await session.control(snapshotId, ref);
        if (needsReview(control)) return review(snapshotId, ref, `click ${control.label}`);
        return session.click(snapshotId, ref);
      }
      case 'fill': case 'program_create': case 'program_update': {
        const view = await session.fill(snapshotId, args.fields as Field[]);
        return { status: 'form_prepared', message: 'Fields are filled. No save or submit button was clicked. Inspect the form, then use etric_program_save.', page: view };
      }
      case 'program_list': return session.openSection('View My Programme');
      case 'program_read': return session.snapshot();
      case 'program_save': case 'program_delete': {
        const control = await session.control(snapshotId, ref);
        const expected = action === 'program_delete' ? /\b(delete|remove)\b/i : /\b(save|submit|update|create|confirm|register)\b/i;
        if (!expected.test(control.label)) throw new Error(`The selected control does not look like a ${action === 'program_delete' ? 'delete' : 'save'} action. Inspect the page first.`);
        return review(snapshotId, ref, action === 'program_delete' ? 'delete program' : 'save program');
      }
      case 'close': await session.close(); return { status: 'browser_closed', message: 'Saved credentials and the persistent profile are retained.' };
      case 'stop': await session.close(); setTimeout(() => server.close(() => process.exit(0)), 100); return { status: 'worker_stopped' };
      default: throw new Error('Unknown local action.');
    }
  }
  function respond(res: ServerResponse, code: number, content: unknown, html = false): void {
    if (res.writableEnded) return;
    res.writeHead(code, { ...localResponseHeaders, 'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json' });
    res.end(html ? content as string : JSON.stringify(content));
  }
  async function body(req: IncomingMessage): Promise<string> {
    let text = '';
    for await (const chunk of req) { text += chunk.toString('utf8'); if (Buffer.byteLength(text) > 65536) throw new Error('Request too large.'); }
    return text;
  }
  const server = createServer((req, res) => {
    void (async () => {
      if (req.headers.host !== `127.0.0.1:${port}`) return respond(res, 403, { error: 'Invalid Host.' });
      const url = new URL(req.url ?? '/', localOrigin);
      const authorized = req.headers.authorization === `Bearer ${token}`;
      if (url.pathname === '/health' && req.method === 'GET') return respond(res, authorized ? 200 : 401, authorized ? { status: 'ok', service: 'etric-mcp', version: 1 } : { error: 'Unauthorized.' });
      if (req.method === 'POST' && ['/credentials', '/decision'].includes(url.pathname)) {
        if (req.headers.origin !== localOrigin) return respond(res, 403, { error: 'Invalid Origin.' });
        if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return respond(res, 415, { error: 'Invalid content type.' });
        const form = new URLSearchParams(await body(req));
        const secret = form.get('token') ?? '';
        if (url.pathname === '/decision') {
          const pending = approvals.get(secret);
          if (!pending || pending.expires < Date.now()) return respond(res, 403, { error: 'This review expired.' });
          approvals.delete(secret);
          pending.resolve(form.get('decision') === 'approve');
          return respond(res, 200, page('Review received', '<h1>Review received</h1><p>You can return to eTRiS or your assistant.</p>'), true);
        }
        if ((credentialTokens.get(secret) ?? 0) < Date.now()) return respond(res, 403, { error: 'This credential form expired.' });
        if (busy) return respond(res, 409, page('Please wait', '<h1>Please wait</h1><p>Finish the current assistant action, then submit this form again.</p>'), true);
        credentialTokens.delete(secret);
        busy = true;
        try {
          const credentials = { username: form.get('username') ?? '', password: form.get('password') ?? '', autoSignIn: form.get('autoSignIn') === 'yes' };
          if (!credentials.username || !credentials.password || credentials.username.length > 100 || credentials.password.length > 50) throw new Error('Invalid credentials.');
          if (form.get('save') === 'yes') await vault.save(credentials);
          attemptedAutoLogin = credentials.autoSignIn;
          const result = await session.signIn(credentials);
          if (result.status === 'login_submitted') attemptedAutoLogin = false;
          respond(res, 200, page('eTRiS login ready', credentials.autoSignIn ? '<h1>Sign-in started</h1><p>Return to the eTRiS tab to check the result and complete any verification.</p>' : '<h1>Login fields are ready</h1><p>Return to the eTRiS tab and click Login. Complete any verification there.</p>'), true);
          if (credentials.autoSignIn && browserMode === 'background') await session.setVisibility(false);
          return;
        } finally { busy = false; }
      }
      if (req.method === 'GET' && url.pathname === '/credentials') {
        if ((credentialTokens.get(url.searchParams.get('token') ?? '') ?? 0) < Date.now()) return respond(res, 403, { error: 'Credential form expired.' });
        return respond(res, 200, credentialPage(url.searchParams.get('token')!), true);
      }
      if (req.method === 'GET' && url.pathname === '/review') {
        const pending = approvals.get(url.searchParams.get('token') ?? '');
        if (!pending || pending.expires < Date.now()) return respond(res, 403, { error: 'Review expired.' });
        return respond(res, 200, reviewPage(url.searchParams.get('token')!, pending.action, pending.details), true);
      }
      if (url.pathname === '/rpc' && req.method === 'POST') {
        if (!authorized || req.headers.origin) return respond(res, 403, { error: 'Unauthorized.' });
        if (!req.headers['content-type']?.startsWith('application/json')) return respond(res, 415, { error: 'Expected JSON.' });
        if (busy) return respond(res, 409, { error: 'A browser action is already in progress. Complete any local review before calling another tool.' });
        busy = true;
        try {
          const request = JSON.parse(await body(req));
          const result = await execute(request.action, request.args ?? {});
          return respond(res, 200, { result });
        } catch (error) {
          // Avoid returning Playwright exceptions which can contain input values.
          const message = error instanceof Error && !error.name.includes('Timeout') && !/locator\.|page\.|frame\./i.test(error.message) ? error.message : 'Browser action failed. Inspect the page and retry; do not assume it succeeded.';
          return respond(res, 400, { error: message });
        } finally { busy = false; }
      }
      respond(res, 404, { error: 'Not found.' });
    })().catch(() => respond(res, 500, { error: 'Local request failed. No credential details are logged.' }));
  });
  await mkdir(dataDir, { recursive: true });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  await writeFile(tokenFile, token, { mode: 0o600 });
  const shutdown = () => { void session.close().finally(() => server.close(() => process.exit(0))); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
