// JSON file store. Each transaction takes a file lock, reads the whole file, applies changes in memory,
// and atomically replaces the file only if the work succeeds. No database is used.
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { type Data, type DocumentRow } from '../shared/schemas';
import { documentName, validateShape, type AppStorage } from './storage';
export { validateShape } from './storage';

// Runtime data lives outside the build; the ignore comments keep bundling from tracing the whole project.
export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || './data');
export const UPLOAD_DIR = path.join(/*turbopackIgnore: true*/ DATA_DIR, 'uploads');
export const SEED_DOCUMENT_DIR = path.resolve(/*turbopackIgnore: true*/ process.cwd(), 'demo', 'documents');

export class JsonStore implements AppStorage {
  /** Test hook: runs after the work and before the file is replaced. Throwing aborts the write. */
  beforeCommit?: (data: Data) => void;
  constructor(readonly filePath: string) {}

  async readDocument(doc: Pick<DocumentRow, 'fileName' | 'storage'>): Promise<Uint8Array> {
    const dir = doc.storage === 'seed' ? SEED_DOCUMENT_DIR : path.join(path.dirname(this.filePath), 'uploads');
    return new Uint8Array(await readFile(path.join(/*turbopackIgnore: true*/ dir, documentName(doc.fileName))));
  }

  async writeUpload(fileName: string, bytes: Uint8Array, _mimeType: string): Promise<void> {
    const dir = path.join(path.dirname(this.filePath), 'uploads');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(/*turbopackIgnore: true*/ dir, documentName(fileName)), bytes);
  }

  async deleteUpload(fileName: string): Promise<void> {
    await unlink(path.join(path.dirname(this.filePath), 'uploads', documentName(fileName))).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  private lock() {
    return lockfile.lock(this.filePath, { realpath: false, stale: 20000, retries: { retries: 200, factor: 1, minTimeout: 15, maxTimeout: 15 } });
  }

  async transaction<T>(work: (data: Data) => T | Promise<T>): Promise<T> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const release = await this.lock();
    try {
      const original = await readFile(this.filePath, 'utf8');
      const data = JSON.parse(original) as Data;
      validateShape(data);
      const result = await work(data);
      validateShape(data);
      const next = JSON.stringify(data, null, 1);
      if (next !== original) {
        this.beforeCommit?.(data);
        await this.writeAtomic(next);
      }
      return result;
    } finally {
      await release();
    }
  }

  /** Writes `data` if no valid file exists (or always when `overwrite`). An unreadable file is kept aside. */
  async seed(data: Data, overwrite = false): Promise<boolean> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const release = await this.lock();
    try {
      try {
        validateShape(JSON.parse(await readFile(this.filePath, 'utf8')));
        if (!overwrite) return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          if (!overwrite) throw error;
          await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
        }
      }
      validateShape(data);
      await this.writeAtomic(JSON.stringify(data, null, 1));
      return true;
    } finally {
      await release();
    }
  }

  private async writeAtomic(json: string): Promise<void> {
    const temp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(json, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, this.filePath);
    } finally {
      await unlink(temp).catch(() => {});
    }
  }
}

export const store = new JsonStore(path.join(DATA_DIR, 'app-data.json'));
