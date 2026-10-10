import { execFileSync } from 'node:child_process';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

const required = ['LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'rodmap.md', '.github/CODEOWNERS', '.github/dependabot.yml', '.github/workflows/ci.yml', '.github/PULL_REQUEST_TEMPLATE.md', '.github/ISSUE_TEMPLATE/bug.yml'];
// Use a fixed executable location so an untrusted PATH cannot select a fake Git.
const gitBinary = process.platform === 'win32' ? 'C:/Program Files/Git/cmd/git.exe' : '/usr/bin/git';
const tracked = execFileSync(gitBinary, ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
let failures = 0;
function reject(message) { console.error(message); failures++; }
for (const file of required) { try { await access(file); } catch { reject(`Required public project file missing: ${file}`); } }
for (const file of tracked) {
  if (/(^|\/)(?:node_modules|dist|browser|screenshots|downloads|test-results|playwright-report|release)(\/|$)|(^|\/)worker-token$|\.(?:dpapi|log|zip)$|(^|\/)\.env(?:\.|$)/i.test(file) && !file.endsWith('.env.example')) reject(`Runtime/private file must not be tracked: ${file}`);
  if (file.endsWith('.json')) { try { JSON.parse(await readFile(file, 'utf8')); } catch { reject(`Invalid JSON: ${file}`); } }
  if (file.endsWith('.md')) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(?:https?:|#)/.test(target)) continue;
      try { await access(path.resolve(path.dirname(file), target.split('#')[0])); } catch { reject(`Broken local documentation link in ${file}`); }
    }
  }
  if (file.startsWith('.github/workflows/') && /\.ya?ml$/.test(file)) {
    const source = await readFile(file, 'utf8');
    if (/\bpull_request_target\s*:/.test(source)) reject(`Privileged PR trigger is forbidden: ${file}`);
    for (const match of source.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)) {
      if (!/^(?:actions\/|github\/codeql-action\/)[^@]+@[a-f0-9]{40}$/.test(match[1])) reject(`Action must be approved and pinned to a complete SHA: ${file}`);
    }
  }
}
console.log(`Repository policy checked ${tracked.length} tracked files; failures: ${failures}.`);
if (failures) process.exitCode = 1;
