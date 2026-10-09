import path from 'node:path';
import os from 'node:os';

export const dataDir = path.resolve(process.env.ETRIC_DATA_DIR ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'etric-mcp'));
export const port = Number(process.env.ETRIC_PORT ?? 43127);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ETRIC_PORT must be between 1024 and 65535.');
export const portalUrl = 'https://etris.hrdcorp.gov.my/DigiGov/login.jsp';
export const portalOrigin = new URL(portalUrl).origin;
export const tokenFile = path.join(dataDir, 'worker-token');
export const profileDir = path.join(dataDir, 'browser');
export const vaultFile = path.join(dataDir, 'credentials.dpapi');

export function allowedUrl(value: string): string {
  const url = new URL(value, portalUrl);
  if (url.origin !== portalOrigin || url.username || url.password) throw new Error('Only the eTRiS HTTPS origin is supported.');
  return url.href;
}
