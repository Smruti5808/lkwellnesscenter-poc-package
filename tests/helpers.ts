// Test harness: each test file (a separate process) gets its own temporary data folder.
// Import this first so DATA_DIR is set before server modules load.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dpa-test-'));
process.env.DATA_DIR = DATA_DIR;

const { NextRequest } = require('next/server') as typeof import('next/server');
const { handleApi } = require('../src/server/api') as typeof import('../src/server/api');
const { store } = require('../src/server/store') as typeof import('../src/server/store');
const { makeSeedData } = require('../demo/seed-data') as typeof import('../demo/seed-data');
export { store };

const ORIGIN = 'http://127.0.0.1:3000';
export const reset = () => store.seed(makeSeedData(), true);
export const data = () => store.transaction(d => d);

export type Res = { status: number; body: any; cookie?: string };
export async function call(cookie: string | null, method: string, route: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  const request = new NextRequest(`${ORIGIN}/api/v1/${route}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { host: '127.0.0.1:3000', origin: ORIGIN, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
  });
  const response = await handleApi(request, route.split('?')[0].split('/'));
  const text = await response.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* binary or attachment */ }
  return { status: response.status, body: parsed, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

/** Multipart POST to the document upload endpoint. */
export async function upload(cookie: string, fields: Record<string, string>, file = new File([Buffer.from('%PDF-1.4\n% demo\n')], 'demo.pdf', { type: 'application/pdf' })): Promise<Res> {
  const form = new FormData();
  form.set('file', file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const request = new NextRequest(`${ORIGIN}/api/v1/documents/upload`, { method: 'POST', body: form, headers: { host: '127.0.0.1:3000', origin: ORIGIN, cookie } });
  const response = await handleApi(request, ['documents', 'upload']);
  return { status: response.status, body: await response.json() };
}

export async function login(email: string): Promise<string> {
  const res = await call(null, 'POST', 'auth/login', { identifier: email, pin: '1234' });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.cookie!;
}
export const as = async (email: string) => {
  const cookie = await login(email);
  return {
    get: (route: string) => call(cookie, 'GET', route),
    post: (route: string, body: unknown = {}) => call(cookie, 'POST', route, body),
    patch: (route: string, body: unknown) => call(cookie, 'PATCH', route, body),
    del: (route: string) => call(cookie, 'DELETE', route),
    cookie,
  };
};
