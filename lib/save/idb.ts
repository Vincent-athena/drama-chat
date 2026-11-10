/**
 * A thin promise layer over IndexedDB. Browser only; never call at module top level or during render.
 * Remember: a transaction auto-commits as soon as you await anything that is not one of its own requests.
 */

export const STORE_NAMES = ["progress", "messages", "groups", "events", "notes", "guides", "meta"] as const;
export type StoreName = (typeof STORE_NAMES)[number];

const opened = new Map<string, Promise<IDBDatabase>>();

function upgrade(db: IDBDatabase): void {
  db.createObjectStore("progress", { keyPath: "storyId" });
  const messages = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
  messages.createIndex("byStory", "storyId");
  messages.createIndex("byChat", ["storyId", "chat"]);
  const groups = db.createObjectStore("groups", { keyPath: "id", autoIncrement: true });
  groups.createIndex("byStory", "storyId");
  const events = db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
  events.createIndex("byStory", "storyId");
  db.createObjectStore("notes", { keyPath: ["storyId", "phaseIndex"] });
  db.createObjectStore("guides", { keyPath: ["storyId", "phaseIndex"] });
  db.createObjectStore("meta", { keyPath: "key" });
}

/** One cached open promise per database name (React strict mode mounts effects twice). */
export function openDb(name: string): Promise<IDBDatabase> {
  let p = opened.get(name);
  if (!p) {
    p = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        upgrade(req.result);
        req.transaction!.objectStore("meta").put({ key: "schema", value: 1 });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          opened.delete(name);
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("The save database is blocked by another tab."));
    });
    p.catch(() => opened.delete(name));
    opened.set(name, p);
  }
  return p;
}

/** Closes and forgets a database (used before deleting it). */
export async function closeDb(name: string): Promise<void> {
  const p = opened.get(name);
  opened.delete(name);
  if (p) (await p.catch(() => null))?.close();
}

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/**
 * Runs `fn` inside one transaction and resolves when it has committed. Inside `fn`, await only requests
 * made on `tx` (via `req`); do any other async or JSON work before or after.
 */
export async function withTx<T>(
  db: IDBDatabase,
  stores: StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>
): Promise<T> {
  const tx = db.transaction(stores, mode);
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
  let result: T;
  try {
    result = await fn(tx);
  } catch (err) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    done.catch(() => undefined);
    throw err;
  }
  await done;
  return result;
}

/**
 * Values of an index (or store) for `range`, in key order (`dir: "prev"` goes backwards), keeping those
 * that pass `keep` and stopping after `limit` kept values.
 */
export function collect<T>(
  source: IDBObjectStore | IDBIndex,
  range: IDBKeyRange | IDBValidKey | undefined,
  dir: IDBCursorDirection = "next",
  limit = Infinity,
  keep: (v: T) => boolean = () => true
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const out: T[] = [];
    if (limit <= 0) return resolve(out);
    const c = source.openCursor(range, dir);
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return resolve(out);
      const v = cur.value as T;
      if (keep(v)) out.push(v);
      if (out.length >= limit) return resolve(out);
      cur.continue();
    };
    c.onerror = () => reject(c.error);
  });
}
