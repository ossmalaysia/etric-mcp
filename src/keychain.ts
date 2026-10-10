import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

export type SecurityRunner = (args: string[], input?: string) => Promise<{ code: number | null; output: string }>;
const accessError = () => new Error('Cannot access macOS Keychain. Unlock your login keychain or complete its local access prompt, then retry.');

// Use Apple's fixed executable, no shell, and no secret in the process arguments.
const runSecurity: SecurityRunner = (args, input) => new Promise((resolve, reject) => {
  const child = spawn('/usr/bin/security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let overflow = false;
  child.stdout.setEncoding('utf8').on('data', chunk => {
    if (output.length + chunk.length > 8192) { overflow = true; child.kill(); }
    else output += chunk;
  });
  // Native error details may contain input data. Never return or log them.
  child.stderr.resume();
  const timer = setTimeout(() => { child.kill(); reject(accessError()); }, 30000);
  child.on('error', () => { clearTimeout(timer); reject(accessError()); });
  child.on('close', code => { clearTimeout(timer); overflow ? reject(accessError()) : resolve({ code, output: output.trim() }); });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
});

export class MacKeychain {
  private readonly service: string;
  private readonly account = 'saved-login';
  constructor(file: string, private readonly run: SecurityRunner = runSecurity) {
    // Separate custom data directories and temporary test vaults without putting
    // real usernames or local file paths in Keychain metadata/process arguments.
    this.service = 'org.ossmalaysia.etris-mcp.' + createHash('sha256').update(path.resolve(file)).digest('hex');
  }
  private args(command: string): string[] { return [command, '-s', this.service, '-a', this.account]; }
  private async request(args: string[], input?: string): Promise<{ code: number | null; output: string }> {
    try { return await this.run(args, input); } catch { throw accessError(); }
  }
  async exists(): Promise<boolean> {
    const { code } = await this.request(this.args('find-generic-password'));
    if (code === 44) return false; // errSecItemNotFound, not a locked/denied keychain.
    if (code !== 0) throw accessError();
    return true;
  }
  async save(encoded: string): Promise<void> {
    // security -i reads commands from stdin. Base64 excludes quoting/newline
    // characters, keeping this one bounded command safe for its line parser.
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 2048) throw new Error('Invalid credential data.');
    // Reapplying -T on an existing item changes its ACL and forces a macOS
    // authorization prompt. Preserve the original ACL during ordinary updates.
    const options = await this.exists() ? ['-U'] : ['-T', '/usr/bin/security'];
    const command = [...this.args('add-generic-password'), ...options, '-w', encoded].join(' ') + '\n';
    const { code } = await this.request(['-i'], command);
    if (code !== 0) throw accessError();
  }
  async load(): Promise<string | undefined> {
    const { code, output } = await this.request([...this.args('find-generic-password'), '-w']);
    if (code === 44) return undefined;
    if (code !== 0) throw accessError();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(output) || output.length > 2048) throw new Error('Invalid saved credential data.');
    return output;
  }
  async forget(): Promise<void> {
    const { code } = await this.request(this.args('delete-generic-password'));
    if (code !== 0 && code !== 44) throw accessError();
  }
}
