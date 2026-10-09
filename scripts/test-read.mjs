// Opt-in live read check. Account data stays in memory; output is counts only.
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'etric-live-read-check', version: '1.0.0' });
const passed = new Set();
class ReadCheckError extends Error {}
function check(condition, message) { if (!condition) throw new ReadCheckError(message); }
async function call(name, args = {}) {
  const reply = await client.callTool({ name, arguments: args });
  check(!reply.isError, `${name} returned an error; inspect the local session.`);
  check(!!reply.structuredContent?.result, `${name} did not return structured data.`);
  return reply.structuredContent.result;
}
function authenticated(view) {
  check(!view.loginRequired && !view.loading, 'An authenticated, ready page is required.');
}
function grid(view) {
  for (const frame of view.frames) for (const table of frame.tables) {
    const header = table.find(row => row.includes('Training Programme No.') && row.includes('Course Title'));
    if (header) return { frame, header, rows: table.filter(row => row !== header && row.length === header.length) };
  }
  throw new ReadCheckError('Programme result grid was not found.');
}
const normalized = value => value.replace(/\s+/g, ' ').trim();
function content(view) {
  // Some programme screens rename the application frame to "Others".
  const frame = view.frames.find(frame => frame.visible && frame.controls.some(control => control.tag === 'a' && control.label === 'Programme Information'));
  check(!!frame, 'Programme detail frame was not found.');
  return JSON.stringify({ text: frame.text, controls: frame.controls.map(({ ref, ...control }) => control), tables: frame.tables });
}

let recordsRead = 0;
let tabsRead = 0;
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))] }));
  const discovered = await client.listTools();
  const readTools = discovered.tools.filter(tool => tool.annotations?.readOnlyHint).map(tool => tool.name);
  let status = await call('etric_session_status');
  for (let attempt = 0; status.browser.loading && attempt < 20; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    status = await call('etric_session_status');
  }
  if (status.browser.loginRequired) {
    await call('etric_login');
    status = await call('etric_session_status');
  }
  authenticated(status.browser);
  check(status.mode === 'background', 'Use background mode before starting the live read check.');
  passed.add('etric_session_status');
  const initial = await call('etric_page');
  authenticated(initial);
  passed.add('etric_page');
  const shellUrl = initial.frames.find(frame => frame.index === 0)?.url;
  check(!!shellUrl && new URL(shellUrl).searchParams.get('actionFlag') === 'doLogin', 'Start from the authenticated eTRiS desktop.');
  // Navigate only to the current observed desktop URL, never an invented route.
  const desktop = await call('etric_navigate', { url: shellUrl });
  authenticated(desktop);
  passed.add('etric_navigate');
  const catalog = await call('etric_sections');
  check(catalog.sections.some(section => section.label === 'View My Programme' && section.url), 'Authorized programme section was not found.');
  passed.add('etric_sections');
  const links = await call('etric_links');
  check(!links.loginRequired && links.frames.some(frame => frame.visible && frame.links.length), 'Visible link capture returned no entries.');
  passed.add('etric_links');
  const named = await call('etric_open_section', { name: 'View My Programme' });
  authenticated(named);
  grid(named);
  passed.add('etric_open_section');
  const listed = await call('etric_program_list');
  authenticated(listed);
  const first = grid(listed);
  const numberColumn = first.header.indexOf('Training Programme No.');
  const titleColumn = first.header.indexOf('Course Title');
  const targets = first.rows.map(row => ({ number: row[numberColumn], title: row[titleColumn] }));
  check(targets.length > 0, 'No visible programmes are available to validate detail reads.');
  passed.add('etric_program_list');
  for (const target of targets) {
    const list = await call('etric_program_list');
    authenticated(list);
    const current = grid(list);
    const link = current.frame.controls.find(control => control.tag === 'a' && control.label === target.number && /^\s*onClickColumn\(/.test(control.onclick ?? ''));
    check(!!link, 'An observed programme detail link was not found.');
    // Never click unknown actions or business controls in this read check.
    const args = link.onclick.match(/^\s*onClickColumn\((['"])([^'"\r\n]+)\1\)\s*;?\s*$/);
    check(!!args, 'Programme link handler was not recognized.');
    const route = new URL(args[2], current.frame.url);
    check(route.origin === new URL(current.frame.url).origin && route.searchParams.get('actionFlag') === 'getRegisterForProlusForLoad' && route.searchParams.get('notEditable') === 'Y', 'Programme link was not explicitly view-only.');
    const opened = await call('etric_click', { snapshotId: list.snapshotId, ref: link.ref });
    authenticated(opened);
    let detail = await call('etric_program_read');
    authenticated(detail);
    const controls = detail.frames.flatMap(frame => frame.controls);
    check(controls.some(control => control.tag === 'a' && control.label === 'Course / Content Outline'), 'Programme detail tabs were not loaded.');
    check(detail.frames.some(frame => normalized(frame.text).includes(normalized(target.title)) || frame.controls.some(control => control.value && normalized(control.value).includes(normalized(target.title)))), 'Selected programme title did not match the detail page.');
    tabsRead++;
    for (const label of ['Course / Content Outline', 'Trainer List']) {
      const tab = detail.frames.flatMap(frame => frame.controls).find(control => control.tag === 'a' && control.label === label);
      check(!!tab, 'An expected programme read tab was missing.');
      const before = content(detail);
      await call('etric_click', { snapshotId: detail.snapshotId, ref: tab.ref });
      detail = await call('etric_program_read');
      authenticated(detail);
      check(content(detail) !== before, 'Programme tab content did not change after navigation.');
      tabsRead++;
    }
    recordsRead++;
  }
  passed.add('etric_click');
  passed.add('etric_program_read');
  for (const name of readTools) check(passed.has(name), 'A registered read-only tool was not tested.');
  await call('etric_program_list');
  const final = await call('etric_session_status');
  authenticated(final.browser);
  check(final.mode === 'background', 'Browser must remain in background mode.');
  console.log(JSON.stringify({ status: 'passed', tools: [...passed], authorizedMenuEntries: catalog.sections.length, visibleProgrammesRead: recordsRead, detailTabsRead: tabsRead, browserMode: final.mode, writesPerformed: 0 }, null, 2));
} catch (error) {
  // Only our generic assertions are printed, never raw RPC/Playwright errors.
  console.error(JSON.stringify({ status: 'failed', toolsPassed: [...passed], visibleProgrammesRead: recordsRead, detailTabsRead: tabsRead, message: error instanceof ReadCheckError ? error.message : 'Live check failed; inspect the local session.' }));
  process.exitCode = 1;
} finally { await client.close(); }
