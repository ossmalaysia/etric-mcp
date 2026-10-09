// All worker traffic, including bearer tokens, stays on this exact loopback
// origin. Never follow redirects: a redirect could forward private RPC data.
export async function loopbackRequest(workerPort: number, requestPath: string, options: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<Response> {
  if (!Number.isInteger(workerPort) || workerPort < 1024 || workerPort > 65535 || !requestPath.startsWith('/') || requestPath.startsWith('//') || /[\\\r\n]/.test(requestPath)) throw new Error('Invalid local worker endpoint.');
  const origin = `http://127.0.0.1:${workerPort}`;
  const endpoint = new URL(requestPath, origin);
  if (endpoint.origin !== origin || endpoint.username || endpoint.password) throw new Error('Invalid local worker endpoint.');
  return fetch(endpoint, { method: options.method ?? 'GET', headers: options.headers, body: options.body, signal: AbortSignal.timeout(options.timeoutMs ?? 150000), redirect: 'error' });
}
