// Data tooling: `seed` creates the JSON file if missing, `reset` restores the dummy data, `check` validates it.
import { appendFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { makeSeedData } from '../demo/seed-data';
import { COLLECTIONS, type Data } from '../src/shared/schemas';
import { DATA_DIR, UPLOAD_DIR, store, validateShape } from '../src/server/store';

async function main() {
  const command = process.argv[2];
  if (command === 'seed') {
    console.log(await store.seed(makeSeedData()) ? `Dummy data written to ${store.filePath}` : 'Existing data file kept (use "reset" to restore dummy data).');
  } else if (command === 'reset') {
    if (!process.argv.includes('--yes')) throw new Error('Reset replaces all data (including uploads and sessions). Re-run with --yes to confirm.');
    await store.seed(makeSeedData(), true);
    for (const file of await readdir(UPLOAD_DIR).catch(() => [] as string[])) await rm(path.join(UPLOAD_DIR, file), { force: true });
    await appendFile(path.join(DATA_DIR, 'reset.log'), `${new Date().toISOString()} reset to dummy data\n`);
    console.log('Data reset to dummy data. All sessions signed out.');
  } else if (command !== 'check') {
    throw new Error('Use: seed | reset --yes | check');
  }
  await store.transaction((data: Data) => {
    validateShape(data);
    const counts = Object.fromEntries(COLLECTIONS.map(name => [name, data[name].length]));
    console.log(`Data OK (${store.filePath}):`, JSON.stringify(counts));
  });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
