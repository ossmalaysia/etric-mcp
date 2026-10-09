import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const empty = z.object({}).strict();
const reference = { snapshotId: z.string().uuid(), ref: z.string().min(1).max(100) };
const click = z.object(reference).strict();
const fields = z.object({ snapshotId: reference.snapshotId, fields: z.array(z.object({ ref: reference.ref, value: z.string().max(10000) }).strict()).min(1).max(50) }).strict();
const argsByAction: Record<string, z.ZodType> = {
  login: empty, save_login: empty, forget_login: empty, status: empty,
  page: empty, links: empty, sections: empty, program_list: empty,
  program_read: empty, close: empty, stop: empty,
  open_section: z.object({ name: z.string().min(1).max(500) }).strict(),
  browser_mode: z.object({ visible: z.boolean() }).strict(),
  navigate: z.object({ url: z.string().min(1).max(2000) }).strict(),
  dismiss_popup: z.object({ kind: z.enum(['notice', 'window']).default('notice'), snapshotId: reference.snapshotId.optional(), ref: reference.ref.optional() }).strict(),
  click, program_save: click, program_delete: click,
  fill: fields, program_create: fields, program_update: fields
};

export function parseWorkerRequest(text: string): { action: string; args: Record<string, unknown> } {
  try {
    const request = z.object({ action: z.string(), args: z.unknown().optional() }).strict().parse(JSON.parse(text));
    const schema = Object.hasOwn(argsByAction, request.action) ? argsByAction[request.action] : undefined;
    if (!schema) throw new Error();
    return { action: request.action, args: schema.parse(request.args ?? {}) as Record<string, unknown> };
  } catch {
    // JSON and schema exceptions can quote input values. Never return them.
    throw new Error('Invalid local request. Use the documented action and argument schema.');
  }
}

export function hasBearerToken(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7), 'utf8');
  const expected = Buffer.from(token, 'utf8');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
