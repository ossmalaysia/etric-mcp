import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { port, tokenFile } from './config.js';
import { loopbackRequest } from './transport.js';

async function workerToken(): Promise<string | undefined> {
  try {
    const token = (await readFile(tokenFile, 'utf8')).trim();
    const response = await loopbackRequest(port, '/health', { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 1000 });
    if (response.ok && (await response.json() as { service: string }).service === 'etric-mcp') return token;
  } catch { /* The worker may not have started yet. */ }
  return undefined;
}
export async function ensureWorker(): Promise<string> {
  const existing = await workerToken();
  if (existing) return existing;
  const child = spawn(process.execPath, [fileURLToPath(new URL('./index.js', import.meta.url)), '--worker'], { detached: true, windowsHide: true, stdio: 'ignore', env: process.env });
  let launchError = false;
  child.on('error', () => { launchError = true; });
  child.unref();
  for (let attempt = 0; attempt < 60; attempt++) {
    const token = await workerToken();
    if (token) return token;
    if (launchError) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Cannot start local eTRiS worker on port ${port}. Check whether the port is occupied, or run node dist/index.js --worker for diagnostics.`);
}
export async function callWorker(action: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const token = await ensureWorker();
  const response = await loopbackRequest(port, '/rpc', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, args }) });
  let body: { result?: unknown; error?: string };
  try { body = await response.json() as typeof body; } catch { throw new Error('Invalid local worker response. No response details are returned.'); }
  if (!response.ok) throw new Error(body.error ?? 'Local worker call failed.');
  return body.result;
}
