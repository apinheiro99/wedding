import pg from "pg";
import fs from "node:fs/promises";
import path from "node:path";
import { config, type Config } from "../config";
import { log } from "../log";

// bigint (int8) -> number; our sizes stay well below 2^53
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

const g = globalThis as unknown as { __weddingPool?: pg.Pool; __weddingReady?: Promise<void> };

function poolFor(c: Config, database: string, max = c.PG_POOL_MAX) {
  return new pg.Pool({
    host: c.PG_HOST, port: c.PG_PORT, user: c.PG_USER, password: c.PG_PASSWORD,
    database, max, application_name: "wedding_photos", connectionTimeoutMillis: 10_000,
  });
}

export function db(): pg.Pool {
  if (!g.__weddingPool) g.__weddingPool = poolFor(config(), config().PG_APP_DB);
  return g.__weddingPool;
}

export async function tx<T>(fn: (c: Tx) => Promise<T>, pool: pg.Pool = db()): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await fn(c);
    await c.query("COMMIT");
    return r;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

export const MIGRATIONS_DIR = path.join(process.cwd(), "src/server/db/migrations");

/** Steps 1-3 of spec §5.1: create the application database when missing. */
export async function ensureDatabase(c: Config) {
  const maint = new pg.Client({
    host: c.PG_HOST, port: c.PG_PORT, user: c.PG_USER, password: c.PG_PASSWORD, database: c.PG_MAINTENANCE_DB,
  });
  await maint.connect();
  try {
    const r = await maint.query("SELECT 1 FROM pg_database WHERE datname = $1", [c.PG_APP_DB]);
    if (r.rowCount === 0) {
      // name validated by config regex, safe to interpolate
      await maint.query(`CREATE DATABASE ${c.PG_APP_DB}`).catch((e) => {
        if (e.code !== "42P04") throw e; // concurrent creation
      });
      log.info("db.created", { database: c.PG_APP_DB });
    }
  } finally {
    await maint.end();
  }
}

/** Steps 4-7: lock, apply pending migrations in order, validate. Idempotent. */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await fs.readdir(dir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(742001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await fs.readFile(path.join(dir, f), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        applied.push(f);
        log.info("db.migration.applied", { name: f });
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
    const count = (await client.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n;
    if (count < files.length) throw new Error("Schema version mismatch after migration");
  } finally {
    await client.query("SELECT pg_advisory_unlock(742001)").catch(() => {});
    client.release();
  }
  return applied;
}

export async function schemaStatus(pool: pg.Pool = db()) {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).length;
  const r = await pool.query("SELECT count(*)::int AS n FROM schema_migrations");
  return { expected: files, applied: r.rows[0].n as number };
}
