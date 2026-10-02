// Generic create / read / update / delete over any collection, driven by the rules in collections.ts.
import { z } from 'zod';
import type { CollectionName, Data } from '../shared/schemas';
import { audit, forbidden, invalid, newId, notFound, nowIso, type Ctx } from './context';

export type Op = 'create' | 'update' | 'delete';
export type AnyRow = { id: string; createdAt?: string; updatedAt?: string; [key: string]: unknown };

export type Rule = {
  /** Fields a client may send. Omit to make the collection read-only through the generic API. */
  input?: z.ZodObject<z.ZodRawShape>;
  creatable?: boolean; updatable?: boolean; deletable?: boolean;
  visible: (data: Data, ctx: Ctx, row: AnyRow) => boolean;
  /** Checked against the stored row (update/delete) and against the resulting row (create/update). */
  allow: (data: Data, ctx: Ctx, row: AnyRow, op: Op) => boolean;
  /** Server-owned fields (ownership, stamps, derived values). Return `undefined` for a key to remove it. */
  server?: (data: Data, ctx: Ctx, row: AnyRow, op: Op, existing?: AnyRow) => Record<string, unknown>;
  /** Input fields that are instructions rather than stored values (e.g. `read` → `readAt`). */
  transient?: string[];
  validate?: (data: Data, ctx: Ctx, row: AnyRow, op: Op, existing?: AnyRow) => void;
  after?: (data: Data, ctx: Ctx, row: AnyRow, op: Op, existing?: AnyRow) => void | Promise<void>;
  patientOf?: (row: AnyRow) => string | undefined;
};

const rowsOf = (data: Data, name: CollectionName) => data[name] as unknown as AnyRow[];

function parse(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw invalid('Please check the highlighted fields.', z.flattenError(result.error).fieldErrors as Record<string, string[]>);
  return result.data as Record<string, unknown>;
}

function applyServer(rule: Rule, data: Data, ctx: Ctx, row: AnyRow, op: Op, existing?: AnyRow): AnyRow {
  const next: AnyRow = { ...row, ...(rule.server?.(data, ctx, row, op, existing) ?? {}) };
  for (const key of [...(rule.transient ?? []), ...Object.keys(next).filter(k => next[k] === undefined)]) delete next[key];
  return next;
}

function find(rule: Rule, data: Data, ctx: Ctx, name: CollectionName, id: string): AnyRow {
  const row = rowsOf(data, name).find(r => r.id === id);
  if (!row || !rule.visible(data, ctx, row)) throw notFound();
  return row;
}

export function list(rule: Rule, data: Data, ctx: Ctx, name: CollectionName, filters: Record<string, string>) {
  return rowsOf(data, name).filter(row => rule.visible(data, ctx, row) && Object.entries(filters).every(([key, value]) => String(row[key]) === value));
}

export function read(rule: Rule, data: Data, ctx: Ctx, name: CollectionName, id: string) {
  return find(rule, data, ctx, name, id);
}

export async function create(rule: Rule, data: Data, ctx: Ctx, name: CollectionName, body: unknown) {
  if (!rule.input || rule.creatable === false) throw forbidden('Records of this type cannot be created here.');
  const at = nowIso();
  const row = applyServer(rule, data, ctx, { id: newId(), createdAt: at, updatedAt: at, ...parse(rule.input, body) }, 'create');
  if (!rule.allow(data, ctx, row, 'create')) throw forbidden();
  rule.validate?.(data, ctx, row, 'create');
  rowsOf(data, name).push(row);
  await rule.after?.(data, ctx, row, 'create');
  audit(data, ctx, 'CREATE', { collection: name, recordId: row.id, patientId: (rule.patientOf ?? (r => r.patientId as string | undefined))(row) });
  return row;
}

export async function update(rule: Rule, data: Data, ctx: Ctx, name: CollectionName, id: string, body: unknown) {
  if (!rule.input || rule.updatable === false) throw forbidden('Records of this type cannot be edited here.');
  const existing = find(rule, data, ctx, name, id);
  if (!rule.allow(data, ctx, existing, 'update')) throw forbidden();
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Send an object of fields to change.');
  const keys = Object.keys(rule.input.shape);
  const unknown = Object.keys(body).filter(k => !keys.includes(k));
  if (unknown.length) throw invalid(`These fields cannot be changed: ${unknown.join(', ')}.`);
  // Merge the change into the stored values, then validate the whole record (keeps cross-field rules enforced).
  const merged: Record<string, unknown> = Object.fromEntries(keys.filter(k => existing[k] !== undefined).map(k => [k, existing[k]]));
  for (const [key, value] of Object.entries(body)) { if (value === null) delete merged[key]; else merged[key] = value; }
  const parsed = parse(rule.input, merged);
  const base: AnyRow = { ...existing };
  for (const key of keys) delete base[key];
  const row = applyServer(rule, data, ctx, { ...base, ...parsed, id: existing.id, createdAt: existing.createdAt, updatedAt: nowIso() }, 'update', existing);
  if (!rule.allow(data, ctx, row, 'update')) throw forbidden();
  rule.validate?.(data, ctx, row, 'update', existing);
  const rows = rowsOf(data, name);
  rows[rows.indexOf(existing)] = row;
  await rule.after?.(data, ctx, row, 'update', existing);
  audit(data, ctx, 'UPDATE', { collection: name, recordId: id, patientId: (rule.patientOf ?? (r => r.patientId as string | undefined))(row), detail: Object.keys(body).join(',') });
  return row;
}

export async function remove(rule: Rule, data: Data, ctx: Ctx, name: CollectionName, id: string) {
  if (rule.deletable === false || (!rule.input && rule.deletable !== true)) throw forbidden('Records of this type cannot be deleted here.');
  const existing = find(rule, data, ctx, name, id);
  if (!rule.allow(data, ctx, existing, 'delete')) throw forbidden();
  rule.validate?.(data, ctx, existing, 'delete', existing);
  const rows = rowsOf(data, name);
  rows.splice(rows.indexOf(existing), 1);
  await rule.after?.(data, ctx, existing, 'delete', existing);
  audit(data, ctx, 'DELETE', { collection: name, recordId: id, patientId: (rule.patientOf ?? (r => r.patientId as string | undefined))(existing) });
  return { id, deleted: true };
}
