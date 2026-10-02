// Build a private snapshot bundled into the Worker, without paid storage services.
// This never resets an initialized Durable Object and never changes local data.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeSeedData } from '../demo/seed-data';
import { store, DATA_DIR, SEED_DOCUMENT_DIR } from '../src/server/store';
import { documentName, validateShape } from '../src/server/storage';
import type { Bootstrap, BundledBootstrap } from '../src/server/cloudflare-storage';

export async function exportSnapshot(): Promise<{ directory: string; manifest: Bootstrap; files: { key: string; path: string }[] }> {
  const filePrefix = `imports/${randomUUID()}`;
  const directory = path.resolve('tmp', 'cloudflare-import', filePrefix.split('/')[1]);
  await mkdir(directory, { recursive: true });
  const files: { key: string; path: string }[] = [];
  const capture = async (data: Bootstrap['data']) => {
    validateShape(data);
    const unique = new Set<string>();
    for (const doc of data.documents) {
      const name = documentName(doc.fileName), relative = `${doc.storage}/${name}`;
      if (unique.has(relative)) continue;
      unique.add(relative);
      const source = path.join(doc.storage === 'seed' ? SEED_DOCUMENT_DIR : path.join(DATA_DIR, 'uploads'), name);
      const target = path.join(directory, doc.storage, name);
      await mkdir(path.dirname(target), { recursive: true });
      // A missing referenced document aborts the import instead of losing it silently.
      await copyFile(source, target);
      files.push({ key: `${filePrefix}/${relative}`, path: target });
    }
    return { version: 1 as const, filePrefix, data };
  };
  let manifest: Bootstrap;
  try {
    await readFile(store.filePath, 'utf8');
    // Copy data and referenced files under the same local lock as API writes.
    manifest = await store.transaction(capture);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || (error as NodeJS.ErrnoException).path !== store.filePath) throw error;
    // A clean checkout has no runtime JSON file. Export the bundled dummy data without writing to disk.
    manifest = await capture(makeSeedData());
  }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(path.join(directory, 'files.json'), JSON.stringify(files, null, 2));
  return { directory, manifest, files };
}

async function main() {
  const command = process.argv[2];
  if (!['export', 'prepare'].includes(command)) throw new Error('Use export | prepare');
  const snapshot = await exportSnapshot();
  console.log(`Snapshot: ${snapshot.directory} (${snapshot.files.length} private documents). Local data kept intact.`);
  if (command === 'export') return;
  const bootstrap: BundledBootstrap = { ...snapshot.manifest, files: {} };
  for (const file of snapshot.files) {
    const key = file.key.slice(snapshot.manifest.filePrefix.length + 1);
    bootstrap.files[key] = (await readFile(file.path)).toString('base64');
  }
  await writeFile(path.resolve('cloudflare/bootstrap.generated.json'), JSON.stringify(bootstrap));
  console.log('Private Worker bootstrap prepared. A fresh SQLite Durable Object imports it on first use; existing live data is never overwritten. No R2 or payment activation required.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
