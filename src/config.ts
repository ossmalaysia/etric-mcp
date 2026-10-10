import path from 'node:path';
import os from 'node:os';

export function defaultDataDir(platform = process.platform, home = os.homedir(), localAppData = process.env.LOCALAPPDATA): string {
  if (platform === 'darwin') return path.posix.join(home, 'Library', 'Application Support', 'etris-mcp');
  if (platform === 'win32') return path.win32.join(localAppData ?? home, 'etric-mcp');
  return path.join(home, 'etric-mcp');
}
export const dataDir = path.resolve(process.env.ETRIC_DATA_DIR ?? defaultDataDir());
export const port = Number(process.env.ETRIC_PORT ?? 43127);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ETRIC_PORT must be between 1024 and 65535.');
export const portalUrl = 'https://etris.hrdcorp.gov.my/DigiGov/login.jsp';
export const portalOrigin = new URL(portalUrl).origin;
export const tokenFile = path.join(dataDir, 'worker-token');
export const profileDir = path.join(dataDir, 'browser');
export const vaultFile = path.join(dataDir, 'credentials.dpapi');
export const browserMode = process.env.ETRIC_BROWSER_MODE ?? 'background';
if (!['background', 'visible'].includes(browserMode)) throw new Error('ETRIC_BROWSER_MODE must be background or visible.');

export function allowedUrl(value: string): string {
  const url = new URL(value, portalUrl);
  if (url.origin !== portalOrigin || url.username || url.password) throw new Error('Only the eTRiS HTTPS origin is supported.');
  return url.href;
}
