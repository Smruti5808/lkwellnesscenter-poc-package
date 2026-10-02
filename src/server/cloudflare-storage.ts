import type { DurableObjectStorage } from '@cloudflare/workers-types';
import type { Data, DocumentRow } from '../shared/schemas';
import { documentName, validateShape, type AppStorage } from './storage';

export type Bootstrap = { version: 1; filePrefix: string; data: Data };
export type BundledBootstrap = Bootstrap & { files: Record<string, string> };

// SQLite Durable Objects are available on Workers Free. Records and private files
// stay together; chunks preserve the existing 5 MB upload limit below SQL row limits.
export class CloudflareStore implements AppStorage {
  private tail: Promise<unknown> = Promise.resolve();
  private writes = new Map<string, Uint8Array>();
  private deleted = new Set<string>();

  constructor(private readonly disk: DurableObjectStorage, private readonly bootstrap: BundledBootstrap) {
    disk.sql.exec('CREATE TABLE IF NOT EXISTS app_chunks (id INTEGER PRIMARY KEY, json TEXT NOT NULL)');
    disk.sql.exec('CREATE TABLE IF NOT EXISTS app_files (name TEXT NOT NULL, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (name, part))');
  }

  private readJson(): string {
    return this.disk.sql.exec<{ json: string }>('SELECT json FROM app_chunks ORDER BY id').toArray().map(row => row.json).join('');
  }

  private saveJson(json: string): void {
    this.disk.sql.exec('DELETE FROM app_chunks');
    for (let offset = 0, id = 0; offset < json.length; id++) {
      let end = Math.min(offset + 64 * 1024, json.length);
      // Never split a Unicode surrogate pair across UTF-8 encoded SQL rows.
      const last = json.charCodeAt(end - 1);
      if (end < json.length && last >= 0xD800 && last <= 0xDBFF) end--;
      this.disk.sql.exec('INSERT INTO app_chunks (id, json) VALUES (?, ?)', id, json.slice(offset, end));
      offset = end;
    }
  }

  private saveFile(name: string, bytes: Uint8Array): void {
    this.disk.sql.exec('DELETE FROM app_files WHERE name = ?', name);
    const size = 256 * 1024;
    for (let offset = 0, part = 0; offset < bytes.length || part === 0; offset += size, part++) {
      this.disk.sql.exec('INSERT INTO app_files (name, part, bytes) VALUES (?, ?, ?)', name, part, bytes.slice(offset, offset + size).buffer as ArrayBuffer);
    }
  }

  private initialize(): string {
    const existing = this.readJson();
    if (existing) return existing; // Redeployments never overwrite live demo changes.
    if (this.bootstrap.version !== 1) throw new Error('Invalid demo bootstrap.');
    validateShape(this.bootstrap.data);
    const files = new Map<string, Uint8Array>();
    for (const doc of this.bootstrap.data.documents) {
      const key = `${doc.storage}/${documentName(doc.fileName)}`;
      const base64 = this.bootstrap.files[key];
      if (base64 === undefined) throw new Error(`Imported document is missing: ${doc.fileName}`);
      if (!files.has(key)) files.set(key, Uint8Array.from(atob(base64), char => char.charCodeAt(0)));
    }
    const json = JSON.stringify(this.bootstrap.data);
    this.disk.transactionSync(() => {
      for (const [key, bytes] of files) this.saveFile(key, bytes);
      this.saveJson(json);
    });
    return json;
  }

  transaction<T>(work: (data: Data) => T | Promise<T>): Promise<T> {
    // Queue the entire asynchronous operation, including request body parsing.
    const result = this.tail.then(async () => {
      const original = this.initialize();
      const data = JSON.parse(original) as Data;
      validateShape(data);
      this.writes.clear(); this.deleted.clear();
      try {
        const result = await work(data);
        validateShape(data);
        const next = JSON.stringify(data);
        if (next !== original || this.writes.size || this.deleted.size) {
          this.disk.transactionSync(() => {
            for (const key of this.deleted) this.disk.sql.exec('DELETE FROM app_files WHERE name = ?', key);
            for (const [key, bytes] of this.writes) this.saveFile(key, bytes);
            if (next !== original) this.saveJson(next);
          });
        }
        return result;
      } finally {
        // Exceptions leave both records and file bytes unchanged.
        this.writes.clear(); this.deleted.clear();
      }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  async readDocument(doc: Pick<DocumentRow, 'fileName' | 'storage'>): Promise<Uint8Array> {
    const key = `${doc.storage}/${documentName(doc.fileName)}`;
    if (this.deleted.has(key)) throw new Error('Document file missing.');
    const pending = this.writes.get(key);
    if (pending) return pending.slice();
    const rows = this.disk.sql.exec<{ bytes: ArrayBuffer }>('SELECT bytes FROM app_files WHERE name = ? ORDER BY part', key).toArray();
    if (!rows.length) throw new Error('Document file missing.');
    const bytes = new Uint8Array(rows.reduce((size, row) => size + row.bytes.byteLength, 0));
    let offset = 0;
    for (const row of rows) { bytes.set(new Uint8Array(row.bytes), offset); offset += row.bytes.byteLength; }
    return bytes;
  }

  async writeUpload(fileName: string, bytes: Uint8Array, _mimeType: string): Promise<void> {
    const key = `upload/${documentName(fileName)}`;
    this.deleted.delete(key);
    this.writes.set(key, bytes.slice());
  }

  async deleteUpload(fileName: string): Promise<void> {
    const key = `upload/${documentName(fileName)}`;
    this.writes.delete(key);
    this.deleted.add(key);
  }
}
