import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const destination = 'release/etric-mcp';
await mkdir(path.join(destination, 'dist'), { recursive: true });
// Exact allowlist: never copy the checkout, user data, profiles, or test fixtures.
for (const file of ['LICENSE', 'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CODE_OF_CONDUCT.md', 'AGENTS.md', 'CLAUDE.md', 'intents.md', 'learning.md', 'package.json', 'package-lock.json', 'mcp-config.example.json']) await copyFile(file, path.join(destination, file));
for (const module of ['browser', 'client', 'config', 'index', 'navigation', 'security', 'transport', 'ui', 'vault', 'worker']) await copyFile(`dist/${module}.js`, path.join(destination, 'dist', `${module}.js`));
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) throw new Error('Release tag must match package.json version.');
await writeFile(path.join(destination, 'INSTALL.txt'), 'Requires Node.js 22 or later and Edge/Chrome. Run npm ci --omit=dev --ignore-scripts, then node dist/index.js --login. Configure your MCP client with the absolute path to dist/index.js. Never store account data in this folder.\n');
console.log('Public runtime package prepared from the explicit file allowlist.');
