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
import { needsReview, fingerprint } from '../worker.js';
import { escapeHtml } from '../ui.js';

test('navigation origins and review classification', () => {
  assert.equal(new URL(allowedUrl('/DigiGov/login.jsp')).hostname, 'etris.hrdcorp.gov.my');
  for (const url of ['https://example.com/', 'http://etris.hrdcorp.gov.my/', 'javascript:alert(1)', 'https://user:password@etris.hrdcorp.gov.my/']) assert.throws(() => allowedUrl(url));
  const control = { ref: 'test', tag: 'button', type: 'button', label: 'Save Program' };
  assert.equal(needsReview(control), true);
  assert.equal(needsReview({ ...control, label: 'Delete Program' }), true);
  assert.equal(needsReview({ ...control, label: 'Unrecognized Action' }), true);
  assert.equal(needsReview({ ...control, label: 'Program Management' }), false);
  assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');
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
    for (const name of ['etric_login', 'etric_save_login', 'etric_program_create', 'etric_program_read', 'etric_program_update', 'etric_program_delete']) assert.ok(tools.some(tool => tool.name === name));
    for (const tool of tools) assert.ok(!Object.keys(tool.inputSchema.properties ?? {}).some(key => /password|username/i.test(key)));
    const invalid = await client.callTool({ name: 'etric_fill', arguments: { snapshotId: 'invalid', fields: [] } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
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
    assert.equal((await fetch(`${base}/health`)).status, 401);
    assert.equal((await fetch(`${base}/health`, { headers: auth })).status, 200);
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${base}/health`, { headers: { ...auth, Host: 'attacker.example' } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(wrongHost, 403);
    assert.equal((await fetch(`${base}/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/rpc`, { method: 'POST', headers: { ...auth, Origin: 'https://attacker.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/credentials?token=invalid`)).status, 403);
    assert.equal((await fetch(`${base}/credentials`, { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=invalid' })).status, 403);
    assert.equal((await fetch(`${base}/rpc`, { method: 'POST', headers: auth, body: JSON.stringify({ action: 'unknown' }) })).status, 400);
    assert.equal((await fetch(`${base}/rpc`, { method: 'POST', headers: auth, body: 'x'.repeat(66000) })).status, 400);
    assert.ok(!(await readFile(path.join(folder, 'worker-token'), 'utf8')).includes('fixture-user'));
  } finally {
    child.kill();
    await new Promise<void>(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', () => resolve()); });
    await rm(folder, { recursive: true, force: true });
  }
});
