import { AsyncLocalStorage } from 'node:async_hooks';
import { COLLECTIONS, type Data, type DocumentRow } from '../shared/schemas';

export interface AppStorage {
  transaction<T>(work: (data: Data) => T | Promise<T>): Promise<T>;
  readDocument(document: Pick<DocumentRow, 'fileName' | 'storage'>): Promise<Uint8Array>;
  writeUpload(fileName: string, bytes: Uint8Array, mimeType: string): Promise<void>;
  deleteUpload(fileName: string): Promise<void>;
}

export function validateShape(data: Data): void {
  if (!data || data.version !== 1) throw new Error('Unsupported data file version.');
  for (const name of COLLECTIONS) {
    const rows = data[name] as { id: string }[];
    if (!Array.isArray(rows)) throw new Error(`Missing collection "${name}".`);
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row.id !== 'string' || ids.has(row.id)) throw new Error(`Invalid or duplicate id in "${name}".`);
      ids.add(row.id);
    }
  }
}

// Database keys and local paths use the same filename; reject paths instead of changing them.
export function documentName(name: string): string {
  if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new Error('Invalid document filename.');
  return name;
}

const context = new AsyncLocalStorage<AppStorage>();
export const withStorage = <T>(storage: AppStorage, work: () => T): T => context.run(storage, work);
export async function getStorage(): Promise<AppStorage> {
  const storage = context.getStore();
  if (storage) return storage;
  // Only the local Node server uses disk. Cloudflare always supplies a request-scoped backend.
  return (await import('./store')).store;
}
