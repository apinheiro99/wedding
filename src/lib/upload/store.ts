// IndexedDB persistence of the upload manifest so a refresh/crash can resume (§9.6).
const DB = "wedding-uploads", STORE = "items";
let dbp: Promise<IDBDatabase> | null = null;
function open() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "key" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
export type Persisted = {
  key: string; name: string; size: number; type: string; lastModified: number; relPath: string;
  state: string; uploadId?: string | null; sha256?: string | null; reason?: string | null; file?: File | null; addedAt: number;
};
export async function putMany(rows: Persisted[]) {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const t = db.transaction(STORE, "readwrite");
    const s = t.objectStore(STORE);
    for (const r of rows) {
      try { s.put(r); } catch { s.put({ ...r, file: null }); } // some browsers can't store File
    }
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  });
}
export async function all(): Promise<Persisted[]> {
  const db = await open();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).getAll();
    r.onsuccess = () => res(r.result as Persisted[]); r.onerror = () => rej(r.error);
  });
}
export async function removeMany(keys: string[]) {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const t = db.transaction(STORE, "readwrite");
    for (const k of keys) t.objectStore(STORE).delete(k);
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  });
}
