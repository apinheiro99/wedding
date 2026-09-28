import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import { loadConfig, setConfigForTests, type Config } from "@/server/config";
import { ensureDatabase, migrate, db } from "@/server/db";
import { ensureStorage } from "@/server/storage";

if (process.env.NODE_ENV !== "test") {
  throw new Error("Integration test harness refuses to run outside NODE_ENV=test");
}

export type Harness = { config: Config; tmpDir: string; teardown: () => Promise<void> };

export async function setupHarness(): Promise<Harness> {
  const dbName = `wedding_test_${crypto.randomBytes(6).toString("hex")}`;
  if (!/^wedding_test_[0-9a-f]+$/.test(dbName)) throw new Error("bad generated db name");

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wedding-int-"));

  const config = loadConfig({
    PG_HOST: process.env.PG_TEST_HOST ?? "localhost",
    PG_PORT: process.env.PG_TEST_PORT ?? "5432",
    PG_USER: process.env.PG_TEST_USER ?? "postgres",
    PG_PASSWORD: process.env.PG_TEST_PASSWORD ?? "",
    PG_APP_DB: dbName,
    STORAGE_ROOT: tmpDir,
    EMAIL_PROVIDER: "memory",
    SESSION_SECRET: "s".repeat(40),
    FAMILY_BOOTSTRAP_LOGIN: "familia",
    FAMILY_BOOTSTRAP_PASSWORD: "segredo123",
    ADMIN_EMAIL: "admin@test.local",
    ADMIN_BOOTSTRAP_PASSWORD: "admin-pass-123",
    NODE_ENV: "test",
    PACKAGE_TARGET_BYTES: "50000",
  } as any);

  setConfigForTests(config);

  await ensureDatabase(config);
  await migrate(db());
  await ensureStorage();

  const teardown = async () => {
    const g = globalThis as unknown as { __weddingPool?: pg.Pool };
    if (g.__weddingPool) {
      await g.__weddingPool.end().catch(() => {});
      g.__weddingPool = undefined;
    }
    const maint = new pg.Client({
      host: config.PG_HOST, port: config.PG_PORT, user: config.PG_USER, password: config.PG_PASSWORD,
      database: config.PG_MAINTENANCE_DB,
    });
    await maint.connect();
    try {
      if (!/^wedding_test_[0-9a-f]+$/.test(config.PG_APP_DB)) throw new Error("refusing to drop non-test db");
      await maint.query(`DROP DATABASE IF EXISTS ${config.PG_APP_DB} WITH (FORCE)`);
    } finally {
      await maint.end();
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  };

  return { config, tmpDir, teardown };
}
