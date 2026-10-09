import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import os from 'node:os';
import { createServer, request as httpRequest } from 'node:http';
import { BrowserSession, type View } from '../browser.js';
import { Vault } from '../vault.js';
import { allowedUrl } from '../config.js';
import { needsReview, fingerprint, localResponseHeaders } from '../worker.js';
import { escapeHtml, credentialPage, reviewPage } from '../ui.js';
import { safeNavigationUrl, selectSection } from '../navigation.js';
import { parseWorkerRequest, hasBearerToken } from '../security.js';
import { loopbackRequest } from '../transport.js';

test('worker validates arguments and does not echo malformed input', () => {
  assert.deepEqual(parseWorkerRequest('{"action":"status"}'), { action: 'status', args: {} });
  for (const input of ['{"action":"status","args":{"password":"fixture-sensitive"}}', '{"action":"navigate","args":{"url":1}}', '{"action":"click","args":{"snapshotId":"invalid","ref":"x"}}', '{"action":"unknown"}', '{"action":"toString"}', '{"password":"fixture-sensitive"', 'null']) {
    assert.throws(() => parseWorkerRequest(input), error => error instanceof Error && !error.message.includes('fixture-sensitive') && error.message.startsWith('Invalid local request.'));
  }
  assert.equal(hasBearerToken('Bearer fixture-token', 'fixture-token'), true);
  for (const header of [undefined, 'fixture-token', 'Bearer wrong', 'Bearer fixture-token-extra']) assert.equal(hasBearerToken(header, 'fixture-token'), false);
});

test('browser blocks navigation to unrelated loopback services', { timeout: 60000 }, async () => {
  let unrelatedHits = 0;
  const portal = createServer((_req, res) => res.end('<title>Fixture portal</title><p>Fixture page</p>'));
  const unrelated = createServer((_req, res) => { unrelatedHits++; res.end('<p>Unrelated service</p>'); });
  await Promise.all([portal, unrelated].map(server => new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))));
  const origin = `http://127.0.0.1:${(portal.address() as { port: number }).port}`;
  const forbidden = `http://127.0.0.1:${(unrelated.address() as { port: number }).port}`;
  const folder = await mkdtemp(path.join(os.tmpdir(), 'etric-origin-test-'));
  const session = new BrowserSession(path.join(folder, 'browser'), origin, origin, true);
  try {
    await session.navigate(origin);
    await assert.rejects(session.openLocal(forbidden), /Unsupported local form origin/);
    await assert.rejects((await session.ensure()).goto(forbidden, { timeout: 10000 }), /ERR_FAILED|ERR_ABORTED/);
    assert.equal(unrelatedHits, 0, 'Navigation must be blocked before reaching an unrelated local service');
  } finally { await session.close(); await Promise.all([portal, unrelated].map(server => new Promise<void>(resolve => server.close(() => resolve())))); await rm(folder, { recursive: true, force: true }); }
});

test('worker transport rejects foreign endpoints and does not follow redirects', async () => {
  let targetHits = 0;
  const target = createServer((_req, res) => { targetHits++; res.end('{}'); });
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  const redirect = createServer((_req, res) => { res.writeHead(307, { Location: `http://127.0.0.1:${(target.address() as { port: number }).port}/` }); res.end(); });
  await new Promise<void>(resolve => redirect.listen(0, '127.0.0.1', resolve));
  const localPort = (redirect.address() as { port: number }).port;
  try {
    for (const requestPath of ['https://example.com/', '//example.com/', '/\\example.com/']) await assert.rejects(loopbackRequest(localPort, requestPath), /Invalid local worker endpoint/);
    await assert.rejects(loopbackRequest(localPort, '/rpc', { method: 'POST', body: 'fixture-private-data', timeoutMs: 2000 }));
    assert.equal(targetHits, 0, 'A redirect must never receive private RPC data');
  } finally { await Promise.all([target, redirect].map(server => new Promise<void>(resolve => server.close(() => resolve())))); }
});

test('navigation origins and review classification', () => {
  assert.equal(new URL(allowedUrl('/DigiGov/login.jsp')).hostname, 'etris.hrdcorp.gov.my');
  for (const url of ['https://example.com/', 'http://etris.hrdcorp.gov.my/', 'javascript:alert(1)', 'https://user:password@etris.hrdcorp.gov.my/']) assert.throws(() => allowedUrl(url));
  const control = { ref: 'test', tag: 'button', type: 'button', label: 'Save Program' };
  assert.equal(needsReview(control), true);
  assert.equal(needsReview({ ...control, label: 'Delete Program' }), true);
  assert.equal(needsReview({ ...control, label: 'Unrecognized Action' }), true);
  assert.equal(needsReview({ ...control, label: 'Program Management' }), false);
  const recordLink = { ref: 'test', tag: 'a', type: '', label: '1234567890', onclick: "onClickColumn('digigov.htm?actionFlag=getRegisterForProlusForLoad&trngPrgTxnId=123&notEditable=Y')" };
  assert.equal(needsReview(recordLink), false);
  assert.equal(needsReview({ ...recordLink, onclick: recordLink.onclick.replace('notEditable=Y', 'notEditable=N') }), true);
  assert.equal(needsReview({ ...recordLink, onclick: recordLink.onclick.replace('notEditable=Y', 'notEditable=Y&notEditable=N') }), true);
  assert.equal(needsReview({ ...recordLink, onclick: recordLink.onclick.replace('getRegisterForProlusForLoad', 'deleteRecord') }), true);
  assert.equal(needsReview({ ...recordLink, onclick: recordLink.onclick.replace('digigov.htm?', 'https://example.com/DigiGov/digigov.htm?') }), true);
  assert.equal(needsReview({ ...recordLink, onclick: recordLink.onclick + '; submitRecord()' }), true);
  assert.equal(needsReview({ ...recordLink, label: 'Submit Programme' }), true);
  assert.equal(needsReview({ ...recordLink, onclick: undefined }), true);
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('captured routes retain navigation parameters and remove secrets and record identifiers', () => {
  const route = safeNavigationUrl('digigov.htm;jsessionid=fixture-session?actionFlag=fixtureSearch&applicationMstId=1&elementId=2&token=fixture-token&userId=fixture-account&recordId=fixture-record');
  assert.ok(route);
  assert.equal(new URL(route).searchParams.get('applicationMstId'), '1');
  assert.equal(new URL(route).searchParams.get('elementId'), '2');
  for (const value of ['fixture-session', 'fixture-token', 'fixture-account', 'fixture-record']) assert.ok(!route.includes(value));
  assert.equal(safeNavigationUrl('https://example.com/'), undefined);
  const entries = [{ label: 'View My Programme', path: ['Applications', 'Training Programme', 'View My Programme'], url: route }];
  assert.equal(selectSection(entries, 'view my programme').url, route);
  assert.throws(() => selectSection([...entries, ...entries], 'View My Programme'), /ambiguous/);
});

test('Dojo menu capture, section navigation, background mode, and popup dismissal', { timeout: 60000 }, async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url?.startsWith('/desktop')) {
      res.setHeader('Set-Cookie', 'fixture_session=dummy; Path=/; HttpOnly');
      res.end(`<title>Desktop fixture</title><a id="application" href="#apps" onclick="document.getElementById('apps').innerHTML='<iframe name=iframe_Applications src=/menu></iframe>'">Applications</a><div id="apps"></div><iframe src="/hidden" style="display:none"></iframe>`);
    } else if (req.url?.startsWith('/menu')) {
      res.end(`<title>Menu fixture</title><span role="treeitem">Training Programme</span><script>
const leaf={label:'View My Programme',url:'/programs?actionFlag=fixtureSearch&applicationMstId=1&token=fixture-token'};const root={label:'Applications',children:[{label:'Training Programme',children:[leaf]}]};
window.continentStore0={fetch:r=>r.onComplete([root]),getLabel:i=>i.label,getValue:(i,k)=>i[k],getValues:(i,k)=>i[k]||[]};</script>`);
    } else if (req.url?.startsWith('/programs')) {
      res.end(`<title>Programme fixture</title><h1>View My Programme</h1><a onclick="onClickColumn('/DigiGov/digigov.htm?actionFlag=getRegisterForProlusForLoad&trngPrgTxnId=123&notEditable=Y')">1234567890</a><script>function onClickColumn(url){setTimeout(()=>location.href=url,200)}</script><label for="draft">Draft title</label><input id="draft"><button id="page-close">Close</button><button onclick="document.getElementById('notice').hidden=false">Show notice</button><div id="notice" role="dialog" hidden><p>Fixture notice</p><button onclick="document.getElementById('notice').hidden=true">Dismiss</button></div><button onclick="alert('Dummy notice')">Show alert</button><button onclick="window.open('/popup')">Show popup window</button><button onclick="window.open('/desktop')">Show workspace window</button><table><tr><th>Course Title</th><th>Status</th></tr><tr><td>Dummy course</td><td>Approved</td></tr></table>`);
    } else if (req.url?.startsWith('/DigiGov/digigov.htm')) {
      res.end('<title>Programme detail fixture</title><script>window.name="Fixture record title"</script><h1>Programme Information</h1><p>Dummy record detail</p>');
    } else if (req.url === '/hidden') res.end('<p>Hidden fixture content must not be returned</p><script>const hiddenSourceText="Do not expose script source";</script>');
    else res.end('<title>Popup fixture</title><p>Dummy popup</p>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const folder = await mkdtemp(path.join(os.tmpdir(), 'etric-navigation-test-'));
  const session = new BrowserSession(path.join(folder, 'browser'), `${origin}/desktop`, origin, true);
  try {
    assert.equal(session.mode, 'background');
    let view = await session.navigate(`${origin}/desktop`);
    assert.ok(!JSON.stringify(view).includes('Hidden fixture content'));
    assert.ok(!JSON.stringify(view).includes('Do not expose script source'));
    const catalog = await session.sections();
    assert.equal(catalog.sections.length, 3);
    assert.ok(!JSON.stringify(catalog).includes('fixture-token'));
    view = await session.openSection('View My Programme');
    assert.ok(view.frames.some(frame => frame.text.includes('Dummy course')));
    view = await session.click(view.snapshotId, control(view, '1234567890').ref);
    assert.ok(view.frames.some(frame => frame.text.includes('Dummy record detail')), 'Delayed iframe navigation must finish before returning a detail snapshot');
    const detailFrame = (await session.ensure()).frames().find(frame => frame.parentFrame() && frame.url().includes('getRegisterForProlusForLoad'))!;
    assert.equal(await detailFrame.evaluate(() => window.name), 'Fixture record title');
    // Playwright refreshes the frame name when its next document loads.
    await detailFrame.goto(detailFrame.url(), { waitUntil: 'domcontentloaded' });
    assert.equal(detailFrame.name(), 'Fixture record title');
    view = await session.openSection('View My Programme');
    assert.ok(view.frames.some(frame => frame.text.includes('Dummy course')), 'List navigation must use the iframe element when a detail page renames its window');
    view = await session.fill(view.snapshotId, [{ ref: control(view, 'Draft title').ref, value: 'Unsaved dummy draft' }]);
    await session.setVisibility(true);
    assert.equal(session.mode, 'visible');
    await session.setVisibility(false);
    assert.equal(session.mode, 'background');
    view = await session.snapshot();
    assert.equal(control(view, 'Draft title').value, 'Unsaved dummy draft');
    const browserPage = await session.ensure();
    assert.ok((await browserPage.context().cookies()).some(cookie => cookie.name === 'fixture_session'));
    await assert.rejects(session.dismissPopup('notice', view.snapshotId, control(view, 'Close').ref), /not a recognized/);
    view = await session.click(view.snapshotId, control(view, 'Show notice').ref);
    assert.equal((await session.dismissPopup('notice', view.snapshotId, control(view, 'Dismiss').ref) as { status: string }).status, 'notice_dismissed');
    view = await session.snapshot();
    view = await session.click(view.snapshotId, control(view, 'Show alert').ref);
    assert.ok(view.dismissedDialogs?.includes('alert dismissed'));
    view = await session.click(view.snapshotId, control(view, 'Show popup window').ref);
    for (let i = 0; i < 10 && !view.popupWindows?.length; i++) { await new Promise(resolve => setTimeout(resolve, 100)); view = await session.snapshot(); }
    assert.equal(view.popupWindows?.length, 1);
    assert.equal((await session.dismissPopup('window') as { status: string }).status, 'popup_window_closed');
    view = await session.snapshot();
    assert.ok(view.frames.some(frame => frame.text.includes('View My Programme')));
    view = await session.click(view.snapshotId, control(view, 'Show workspace window').ref);
    for (let i = 0; i < 10 && !view.frames.some(frame => frame.controls.some(control => control.id === 'application')); i++) { await new Promise(resolve => setTimeout(resolve, 100)); view = await session.snapshot(); }
    assert.equal(view.popupWindows?.length, 0, 'Workspace windows must not be classified as notices');
    assert.equal((await session.dismissPopup('window') as { status: string }).status, 'no_popup_window');
    await session.sections();
    await (await session.ensure()).locator('body').evaluate(body => body.insertAdjacentHTML('beforeend', '<p>Session has expired. Please log in again.</p>'));
    view = await session.snapshot();
    assert.equal(view.sessionExpired, true);
    assert.equal(view.loginRequired, true, 'Expired workspace must not be reported as an available session');
    await assert.rejects(session.sections(), /Log in/, 'Cached menus must not bypass the login check');
    await assert.rejects(session.openSection('View My Programme'), /Log in/);
    await (await session.ensure()).locator('body > p').last().evaluate(element => element.remove());
    assert.equal((await session.snapshot()).loginRequired, false);
    assert.equal((await session.sections()).sections.length, 3, 'Authorized menu can be captured again after recovery');
  } finally { await session.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(folder, { recursive: true, force: true }); }
});

test('Windows vault encrypts and round-trips dummy credentials', { skip: process.platform !== 'win32' }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'etric-vault-test-'));
  try {
    const file = path.join(folder, 'credentials.dpapi');
    const vault = new Vault(file);
    assert.equal(await vault.exists(), false);
    const dummy = { username: 'fixture-user', password: 'dummy-password-for-test-only' };
    await vault.save(dummy);
    const stored = await readFile(file, 'utf8');
    assert.ok(!stored.includes(dummy.password));
    assert.ok(!stored.includes(dummy.username));
    assert.deepEqual(await vault.load(), dummy);
    await vault.save({ ...dummy, password: 'updated-dummy-password' });
    assert.equal((await vault.load())!.password, 'updated-dummy-password');
    await vault.save({ ...dummy, autoSignIn: false });
    assert.equal((await vault.load())!.autoSignIn, false);
    await vault.forget();
    assert.equal(await vault.exists(), false);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

const fixture = `<!doctype html><html><title>Program fixture</title><body>
<h1>Program Management</h1><button id="add">Add Program</button><section id="list"></section><section id="form" hidden>
<label for="name">Program Name</label><input id="name" name="name"><label for="code">Program Code</label><input id="code" name="code">
<label for="category">Category</label><select id="category"><option value="general">General</option><option value="technical">Technical</option></select>
<button id="save">Save Program</button></section><iframe title="Help" src="/frame"></iframe>
<script>
const records=[];let editing=-1;const form=document.getElementById('form');const list=document.getElementById('list');
function render(){list.innerHTML='<table><tr><th>Name</th><th>Code</th><th>Actions</th></tr>'+records.map((r,i)=>'<tr><td>'+r.name+'</td><td>'+r.code+'</td><td><button data-edit="'+i+'">Edit '+r.code+'</button><button data-delete="'+i+'">Delete '+r.code+'</button></td></tr>').join('')+'</table>';list.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{editing=Number(b.dataset.edit);document.getElementById('name').value=records[editing].name;document.getElementById('code').value=records[editing].code;form.hidden=false;});list.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>{if(confirm('Delete this fixture program?')){records.splice(Number(b.dataset.delete),1);render();}});}
document.getElementById('add').onclick=()=>{editing=-1;form.hidden=false;document.getElementById('name').value='';document.getElementById('code').value='';};
document.getElementById('save').onclick=()=>{const r={name:document.getElementById('name').value,code:document.getElementById('code').value};if(editing<0)records.push(r);else records[editing]=r;form.hidden=true;render();};render();
</script></body></html>`;

function control(view: View, label: string) {
  const result = view.frames.flatMap(frame => frame.controls).find(item => item.label === label);
  assert.ok(result, `Missing ${label}`);
  return result;
}
test('browser redacts login and supports program form CRUD with fresh references', { timeout: 60000 }, async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/login.jsp') res.end('<title>Login fixture</title><input name="j_username" value="fixture-user"><input name="j_password" type="password" value="dummy-sensitive-value"><input name="btnSubmit" type="button" value="Login" onclick="location.href=\'/programs\'">');
    else if (req.url === '/frame') res.end('<p>Frame content is readable</p><button>Frame Help</button>');
    else res.end(fixture);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const folder = await mkdtemp(path.join(os.tmpdir(), 'etric-browser-test-'));
  const session = new BrowserSession(path.join(folder, 'browser'), `${origin}/login.jsp`, origin, true);
  try {
    const login = await session.navigate(`${origin}/login.jsp`);
    assert.equal(login.loginRequired, true);
    assert.ok(!JSON.stringify(login).includes('dummy-sensitive-value'));
    assert.ok(!JSON.stringify(login).includes('fixture-user'));
    assert.equal((await session.signIn({ username: 'fixture-user', password: 'dummy-sensitive-value', autoSignIn: false })).status, 'saved_login_filled');
    assert.equal((await session.snapshot()).loginRequired, true);
    assert.equal((await session.signIn({ username: 'fixture-user', password: 'dummy-sensitive-value', autoSignIn: true })).status, 'login_submitted');
    let view = await session.navigate(`${origin}/programs`);
    assert.equal(view.loginRequired, false);
    // Wait for the independently loaded frame by asking for another snapshot if needed.
    for (let i = 0; i < 10 && !view.frames.some(f => f.text.includes('Frame content')); i++) { await new Promise(r => setTimeout(r, 100)); view = await session.snapshot(); }
    assert.ok(view.frames.some(frame => frame.text.includes('Frame content')));
    assert.equal(fingerprint(view), fingerprint({ ...view, snapshotId: 'other-id' }));
    view = await session.click(view.snapshotId, control(view, 'Add Program').ref);
    const old = view;
    view = await session.fill(view.snapshotId, [
      { ref: control(view, 'Program Name').ref, value: 'Fixture Course' },
      { ref: control(view, 'Program Code').ref, value: 'FIX001' },
      { ref: control(view, 'Category').ref, value: 'technical' }
    ]);
    await assert.rejects(session.click(old.snapshotId, control(old, 'Save Program').ref), /stale/);
    assert.notEqual(fingerprint(old), fingerprint(view));
    view = await session.click(view.snapshotId, control(view, 'Save Program').ref);
    assert.ok(view.frames[0].tables.some(table => table.some(row => row.includes('Fixture Course') && row.includes('FIX001'))));
    view = await session.click(view.snapshotId, control(view, 'Edit FIX001').ref);
    view = await session.fill(view.snapshotId, [{ ref: control(view, 'Program Name').ref, value: 'Updated Fixture Course' }]);
    view = await session.click(view.snapshotId, control(view, 'Save Program').ref);
    assert.ok(view.frames[0].text.includes('Updated Fixture Course'));
    view = await session.click(view.snapshotId, control(view, 'Delete FIX001').ref, true);
    assert.ok(!view.frames[0].tables.some(table => table.some(row => row.includes('FIX001'))));
    await assert.rejects(session.navigate('https://example.com/'), /origin/);
  } finally { await session.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(folder, { recursive: true, force: true }); }
});

test('stdio client discovers tools without starting a browser or accepting password arguments', async () => {
  const client = new Client({ name: 'fixture-client', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../index.js', import.meta.url))] });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const name of ['etric_login', 'etric_save_login', 'etric_program_create', 'etric_program_read', 'etric_program_update', 'etric_program_delete', 'etric_links', 'etric_sections', 'etric_open_section', 'etric_browser_visibility', 'etric_dismiss_popup']) assert.ok(tools.some(tool => tool.name === name));
    for (const tool of tools) assert.ok(!Object.keys(tool.inputSchema.properties ?? {}).some(key => /password|username/i.test(key)));
    const invalid = await client.callTool({ name: 'etric_fill', arguments: { snapshotId: 'invalid', fields: [] } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
});

test('native browser login and review forms preserve a valid Origin without leaking URL tokens', { timeout: 30000 }, async () => {
  let origin = '';
  const submissions: { origin?: string; referer?: string; path: string }[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', origin);
    if (req.method === 'GET') {
      res.writeHead(200, { ...localResponseHeaders, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(url.pathname === '/credentials' ? credentialPage('fixture-form-token') : reviewPage('fixture-form-token', 'fixture action', 'Dummy program preview'));
    } else {
      submissions.push({ origin: req.headers.origin, referer: req.headers.referer, path: url.pathname });
      req.resume();
      res.writeHead(req.headers.origin === origin ? 200 : 403, { 'Content-Type': 'text/html' });
      res.end(req.headers.origin === origin ? '<p>Fixture form accepted</p>' : '<p>Invalid Origin.</p>');
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const folder = await mkdtemp(path.join(os.tmpdir(), 'etric-form-test-'));
  const session = new BrowserSession(path.join(folder, 'browser'), `${origin}/credentials`, origin, true);
  try {
    const browserPage = await session.ensure();
    await browserPage.goto(`${origin}/credentials?token=fixture-url-token`);
    await browserPage.locator('#username').fill('fixture-user');
    await browserPage.locator('#password').fill('dummy-password-for-test-only');
    const [loginResponse] = await Promise.all([
      browserPage.waitForResponse(response => response.request().method() === 'POST'),
      browserPage.getByRole('button', { name: 'Connect to eTRiS' }).click()
    ]);
    assert.equal(loginResponse.status(), 200, 'The real browser credential form must pass origin validation');
    await browserPage.goto(`${origin}/review?token=fixture-url-token`);
    const [reviewResponse] = await Promise.all([
      browserPage.waitForResponse(response => response.request().method() === 'POST'),
      browserPage.getByRole('button', { name: 'Approve this action' }).click()
    ]);
    assert.equal(reviewResponse.status(), 200, 'The real browser review form must pass origin validation');
    assert.deepEqual(submissions.map(item => item.path), ['/credentials', '/decision']);
    for (const submission of submissions) {
      assert.equal(submission.origin, origin);
      assert.equal(submission.referer, `${origin}/`);
      assert.ok(!submission.referer?.includes('fixture-url-token'));
    }
  } finally { await session.close(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(folder, { recursive: true, force: true }); }
});

test('local worker rejects unauthorized, cross-origin, and oversized requests', { timeout: 25000 }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'etric-worker-test-'));
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const testPort = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const base = `http://127.0.0.1:${testPort}`;
  const child = spawn(process.execPath, [fileURLToPath(new URL('../index.js', import.meta.url)), '--worker'], { env: { ...process.env, ETRIC_DATA_DIR: folder, ETRIC_PORT: String(testPort) }, windowsHide: true, stdio: 'ignore' });
  try {
    let token: string | undefined;
    for (let i = 0; i < 60; i++) {
      try { token = await readFile(path.join(folder, 'worker-token'), 'utf8'); break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(token, 'Worker should start');
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const localRequest = (requestPath: string, options: Parameters<typeof loopbackRequest>[2] = {}) => loopbackRequest(testPort, requestPath, options);
    assert.equal((await localRequest('/health')).status, 401);
    assert.equal((await localRequest('/health', { headers: auth })).status, 200);
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest({ hostname: '127.0.0.1', port: testPort, path: '/health', headers: { Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(wrongHost, 403);
    assert.equal((await localRequest('/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await localRequest('/rpc', { method: 'POST', headers: { ...auth, Origin: 'https://attacker.example' }, body: '{}' })).status, 403);
    assert.equal((await localRequest('/credentials?token=invalid')).status, 403);
    assert.equal((await localRequest('/credentials', { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=invalid' })).status, 403);
    assert.equal((await localRequest('/rpc', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'unknown' }) })).status, 400);
    const malformed = await localRequest('/rpc', { method: 'POST', headers: auth, body: '{"password":"fixture-sensitive"' });
    assert.equal(malformed.status, 400);
    assert.ok(!(await malformed.text()).includes('fixture-sensitive'));
    const wrongArgs = await localRequest('/rpc', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'status', args: { password: 'fixture-sensitive' } }) });
    assert.equal(wrongArgs.status, 400);
    assert.equal((await localRequest('/rpc', { method: 'POST', headers: auth, body: 'x'.repeat(66000) })).status, 400);
    assert.ok(!(await readFile(path.join(folder, 'worker-token'), 'utf8')).includes('fixture-user'));
  } finally {
    child.kill();
    await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); });
    await rm(folder, { recursive: true, force: true });
  }
});
