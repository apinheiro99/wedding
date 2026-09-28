import pg from "pg";
import { config } from "../config";
import { db, type Queryable } from "../db";

export type AppEvent =
  | { t: "upload"; userId: string; uploadId: string; state: string; mediaId?: string | null; reason?: string | null }
  | { t: "media"; mediaId: string; userId: string; change: "ready" | "added" | "deleted" | "restored" }
  | { t: "package"; userId: string; packageId: string; state: string };

/** Publishes via PostgreSQL NOTIFY so worker -> web events work across processes. */
export async function publish(e: AppEvent, q: Queryable = db()) {
  await q.query("SELECT pg_notify('app_events', $1)", [JSON.stringify(e)]);
}

type Listener = (e: AppEvent) => void;
const g = globalThis as unknown as { __weddingListeners?: Set<Listener>; __weddingListen?: Promise<void> };

/** One LISTEN connection per web process, fanned out to SSE subscribers. */
export function subscribe(fn: Listener): () => void {
  g.__weddingListeners ??= new Set();
  g.__weddingListeners.add(fn);
  if (!g.__weddingListen) g.__weddingListen = startListening();
  return () => g.__weddingListeners!.delete(fn);
}

async function startListening() {
  const c = config();
  const client = new pg.Client({ host: c.PG_HOST, port: c.PG_PORT, user: c.PG_USER, password: c.PG_PASSWORD, database: c.PG_APP_DB });
  const reset = () => { g.__weddingListen = undefined; setTimeout(() => { if (g.__weddingListeners?.size) g.__weddingListen = startListening(); }, 2000); };
  client.on("error", () => { client.end().catch(() => {}); reset(); });
  client.on("notification", (n) => {
    if (!n.payload) return;
    let e: AppEvent;
    try { e = JSON.parse(n.payload); } catch { return; }
    for (const l of g.__weddingListeners ?? []) l(e);
  });
  await client.connect();
  await client.query("LISTEN app_events");
}
