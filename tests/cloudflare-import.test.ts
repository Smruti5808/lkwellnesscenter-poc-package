import { DATA_DIR, reset, store } from './helpers';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { exportSnapshot } from '../scripts/cloudflare-data';
import { makeSeedData } from '../demo/seed-data';

beforeEach(reset);

test('snapshot preserves all existing records and uploaded bytes without changing the local store', async () => {
  const bytes = new Uint8Array([0,1,2,255,37,80,68,70]);
  await mkdir(path.join(DATA_DIR,'uploads'),{recursive:true});
  await writeFile(path.join(DATA_DIR,'uploads','existing.pdf'),bytes);
  await store.transaction(data => {
    data.users[0].name = 'Existing edited demo name';
    data.documents.push({...data.documents[0],id:'existing-upload',fileName:'existing.pdf',storage:'upload',byteSize:bytes.length});
  });
  const original = await readFile(store.filePath,'utf8');
  const snapshot = await exportSnapshot();
  assert.deepEqual(snapshot.manifest.data,JSON.parse(original));
  assert.equal(await readFile(store.filePath,'utf8'),original);
  const uploaded = snapshot.files.find(file => file.key.endsWith('/upload/existing.pdf'))!;
  assert.deepEqual(new Uint8Array(await readFile(uploaded.path)),bytes);
  assert.equal(snapshot.files.length,7);
});

test('missing referenced uploads and corrupt data abort instead of silently seeding', async () => {
  await store.transaction(data => { data.documents.push({...data.documents[0],id:'missing-upload',storage:'upload',fileName:'missing.pdf'}); });
  const original = await readFile(store.filePath,'utf8');
  await assert.rejects(exportSnapshot(), /ENOENT/);
  assert.equal(await readFile(store.filePath,'utf8'),original);
  await writeFile(store.filePath,'{corrupt');
  await assert.rejects(exportSnapshot(),SyntaxError);
  assert.equal(await readFile(store.filePath,'utf8'),'{corrupt');
});

test('a clean checkout exports the demo seed without creating a local runtime data file', async () => {
  await rm(store.filePath);
  const snapshot = await exportSnapshot();
  assert.deepEqual(snapshot.manifest.data,makeSeedData());
  assert.equal(snapshot.files.length,6);
  await assert.rejects(readFile(store.filePath),{code:'ENOENT'});
});
