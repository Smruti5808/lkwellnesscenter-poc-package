import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { makeSeedData } from '../demo/seed-data';

test('Cloudflare runtime preserves imported data, serializes bookings, rolls back files, and survives restart', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lk-cloudflare-'));
  const scriptPath = path.join(directory, 'worker.mjs');
  const root = process.cwd().replaceAll('\\', '/');
  const data = makeSeedData(), files: Record<string,string> = {};
  for (const doc of data.documents) files[`${doc.storage}/${doc.fileName}`] = (await readFile(path.join('demo','documents',doc.fileName))).toString('base64');
  const existingBytes = new Uint8Array([37,80,68,70,45,49,46,52]);
  data.documents.push({...data.documents[0],id:'existing-upload',fileName:'existing.pdf',storage:'upload',byteSize:existingBytes.length});
  files['upload/existing.pdf'] = Buffer.from(existingBytes).toString('base64');
  const bundle = (bootstrapData: typeof data) => build({
    stdin: { contents: `
      import { DurableObject } from 'cloudflare:workers';
      import { CloudflareStore } from '${root}/src/server/cloudflare-storage.ts';
      import { withStorage } from '${root}/src/server/storage.ts';
      import { handleApi } from '${root}/src/server/api.ts';
      export class TestData extends DurableObject {
        constructor(ctx, env) { super(ctx, env); this.store = new CloudflareStore(ctx.storage, ${JSON.stringify({version:1,filePrefix:'imports/test-fixture',data:bootstrapData,files})}); }
        async fetch(request) {
          const url = new URL(request.url);
          if (url.pathname === '/__test/data') return Response.json(await this.store.transaction(data => data));
          if (url.pathname === '/__test/file') {
            try { return await this.store.transaction(async () => new Response(await this.store.readDocument({fileName:url.searchParams.get('name'),storage:'upload'}))); }
            catch { return new Response('missing',{status:404}); }
          }
          if (url.pathname === '/__test/rollback') {
            try {
              await this.store.transaction(async data => {
                await this.store.writeUpload('rollback.pdf', new Uint8Array([1,2,3]), 'application/pdf');
                await this.store.deleteUpload('existing.pdf');
                data.users[0].name = 'MUST NOT COMMIT';
                throw new Error('injected');
              });
            } catch { return new Response('rolled back'); }
          }
          if (url.pathname === '/__test/grow') {
            await this.store.transaction(data => { data.audit.push({id:'large-audit', at:new Date().toISOString(), action:'TEST', detail:'🌿'.repeat(600000)}); });
            return new Response('grown');
          }
          return withStorage(this.store, () => handleApi(request, url.pathname.slice('/api/v1/'.length).split('/')));
        }
      }
      export default { fetch(request, env) {
        // Miniflare dispatch rewrites Host to its internal listener; emulate the public edge Host.
        const headers = new Headers(request.headers); headers.set('host', new URL(request.url).host);
        return env.DATA.get(env.DATA.idFromName('demo')).fetch(new Request(request, {headers}));
      } };
    `, resolveDir: process.cwd() },
    bundle: true, outfile: scriptPath, format: 'esm', platform: 'node', target: 'es2022', external: ['cloudflare:workers', 'node:*'],
  });
  await bundle(data);
  const options = convertV4MiniflareOptions({
    name: 'lk-test-demo', modules: true, scriptPath, compatibilityDate: '2026-10-01', compatibilityFlags: ['nodejs_compat'],
    durableObjects: { DATA: { className: 'TestData', useSQLite: true } },
    resourcePersistencePath: path.join(directory, 'state'),
  });
  let runtime = new Miniflare(options);
  try {
    const request = (route: string, method = 'GET', body?: unknown, cookie?: string) => runtime.dispatchFetch(`https://demo.example${route}`, {
      method, headers: { host: 'demo.example', origin: 'https://demo.example', ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.deepEqual(await (await request('/__test/data')).json(), data, 'every imported record and ID is preserved');
    const login = await request('/api/v1/auth/login', 'POST', { identifier: 'ananya@example.com', pin: '1234' });
    assert.equal(login.status, 200, await login.clone().text());
    assert.match(login.headers.get('set-cookie')!, /HttpOnly.*SameSite=Lax.*Secure/);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const beforeRollback = await (await request('/__test/data')).json();
    await request('/__test/rollback', 'POST');
    assert.deepEqual(await (await request('/__test/data')).json(), beforeRollback);
    assert.equal((await request('/__test/file?name=rollback.pdf')).status,404);
    assert.equal((await request('/__test/file?name=existing.pdf')).status,200);

    const download = await request('/api/v1/documents/existing-upload/file', 'GET', undefined, cookie);
    assert.equal(download.status, 200);
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), existingBytes);
    assert.equal((await request('/api/v1/documents/existing-upload/file')).status, 401);

    const form = new FormData();
    const largeUpload = new Uint8Array(5 * 1024 * 1024);
    for (let i = 0; i < largeUpload.length; i++) largeUpload[i] = i % 251;
    largeUpload.set(new TextEncoder().encode('%PDF-1.4\n'));
    form.set('file', new File([largeUpload], 'test.pdf', { type: 'application/pdf' }));
    for (const [key,value] of Object.entries({ patientId:'pat-ananya', title:'Cloud report', category:'other', documentDate:'2026-10-02' })) form.set(key,value);
    const multipart = new Request('https://demo.example/api/v1/documents/upload', { method:'POST', body:form });
    const upload = await runtime.dispatchFetch(multipart.url, { method:'POST', body:Buffer.from(await multipart.arrayBuffer()), headers:{host:'demo.example',origin:'https://demo.example',cookie,'content-type':multipart.headers.get('content-type')!} });
    assert.equal(upload.status, 201, await upload.clone().text());
    const uploaded = (await upload.json() as { data: { id:string; fileName:string } }).data;
    assert.deepEqual(new Uint8Array(await (await request(`/api/v1/documents/${uploaded.id}/file`,'GET',undefined,cookie)).arrayBuffer()),largeUpload,'the existing maximum 5 MB upload survives chunking exactly');

    const doctor = data.doctors[0], type = data.appointmentTypes.find(row => row.doctorId === doctor.id)!;
    const slots = await request(`/api/v1/doctors/${doctor.id}/slots?typeId=${type.id}&days=14`, 'GET', undefined, cookie);
    const start = (await slots.json() as {data:string[]}).data[0];
    assert.ok(start);
    const bookings = await Promise.all(Array.from({length:6}, () => request('/api/v1/c/appointments', 'POST', {patientId:'pat-ananya',doctorId:doctor.id,typeId:type.id,start},cookie)));
    assert.equal(bookings.filter(result => result.status === 201).length,1);
    assert.equal(bookings.filter(result => result.status === 422).length,5);
    await request('/__test/grow', 'POST');
    const preserved = await (await request('/__test/data')).json() as { audit: { id:string; detail?:string }[] };
    assert.equal(preserved.audit.find(row => row.id === 'large-audit')!.detail,'🌿'.repeat(600000),'Unicode survives the chunk boundaries exactly');
    // A new bootstrap/deployment must never replace an initialized dataset.
    await runtime.dispose();
    await bundle(makeSeedData());
    runtime = new Miniflare(options);
    const restored = await request('/__test/data');
    assert.equal(restored.status,200,await restored.clone().text());
    assert.deepEqual(await restored.json(),preserved,'SQLite chunks persist, including a JSON value larger than 2 MB');
    assert.equal((await request('/api/v1/auth/session','GET',undefined,cookie)).status,200);
    assert.deepEqual(new Uint8Array(await (await request(`/api/v1/documents/${uploaded.id}/file`,'GET',undefined,cookie)).arrayBuffer()),largeUpload,'uploaded bytes persist after restart and a changed bootstrap');
    assert.equal((await request(`/api/v1/c/documents/${uploaded.id}`,'DELETE',undefined,cookie)).status,200);
    assert.equal((await request(`/__test/file?name=${uploaded.fileName}`)).status,404);
    assert.equal((await request('/api/v1/c/documents/existing-upload','DELETE',undefined,cookie)).status,200);
    assert.equal((await request('/__test/file?name=existing.pdf')).status,404);
  } finally { await runtime.dispose(); }
});
