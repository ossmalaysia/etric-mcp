import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Credentials { username: string; password: string; autoSignIn?: boolean }

// Passwords travel over the child's stdin, never in command arguments or logs.
async function dpapi(mode: 'protect' | 'unprotect', input: string): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Saved passwords currently require Windows DPAPI. Manual browser login still works.');
  const method = mode === 'protect' ? 'Protect' : 'Unprotect';
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd()
$bytes = [Convert]::FromBase64String($raw)
try {
  $result = [Security.Cryptography.ProtectedData]::${method}($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [Console]::Out.Write([Convert]::ToBase64String($result))
} finally {
  [Array]::Clear($bytes, 0, $bytes.Length)
  if ($result) { [Array]::Clear($result, 0, $result.Length) }
}`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let result = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { result += chunk; });
    // Deliberately discard PowerShell error details: these may contain input data.
    child.stderr.resume();
    const timer = setTimeout(() => { child.kill(); reject(new Error('Windows credential encryption timed out.')); }, 15000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('Cannot start Windows credential encryption.')); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(result.trim()) : reject(new Error('Cannot access saved credentials under this Windows account.')); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export class Vault {
  constructor(private file: string) {}
  async exists(): Promise<boolean> {
    try { await readFile(this.file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }
  async save(credentials: Credentials): Promise<void> {
    if (!credentials.username.trim() || !credentials.password || credentials.username.length > 100 || credentials.password.length > 50) throw new Error('Enter a username (up to 100 characters) and password (up to 50 characters).');
    const encoded = Buffer.from(JSON.stringify(credentials), 'utf8');
    let encrypted: string;
    try { encrypted = await dpapi('protect', encoded.toString('base64')); } finally { encoded.fill(0); }
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, encrypted, { mode: 0o600 });
    await rename(temporary, this.file);
  }
  async load(): Promise<Credentials | undefined> {
    if (!await this.exists()) return undefined;
    const bytes = Buffer.from(await dpapi('unprotect', await readFile(this.file, 'utf8')), 'base64');
    try {
      const result: unknown = JSON.parse(bytes.toString('utf8'));
      if (!result || typeof result !== 'object' || !('username' in result) || !('password' in result) || typeof result.username !== 'string' || typeof result.password !== 'string') throw new Error('Invalid saved credential data.');
      return { username: result.username, password: result.password, ...('autoSignIn' in result && typeof result.autoSignIn === 'boolean' ? { autoSignIn: result.autoSignIn } : {}) };
    } finally { bytes.fill(0); }
  }
  async forget(): Promise<void> { await unlink(this.file).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
