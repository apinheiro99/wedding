import { config } from "./config";
import { db, ensureDatabase, migrate } from "./db";
import { ensureStorage } from "./storage";
import { hashPassword } from "./crypto";
import { setSettingIfMissing } from "./services/settings";
import { log } from "./log";

const g = globalThis as unknown as { __weddingBoot?: Promise<void>; __weddingBootError?: string };

/** Spec §5.1 startup sequence. Idempotent; failure is explicit and surfaced by /ready. */
async function run() {
  const c = config();
  await ensureDatabase(c);
  await migrate(db());
  await ensureStorage();
  await setSettingIfMissing("family_login", c.FAMILY_BOOTSTRAP_LOGIN.toLowerCase());
  const existing = await db().query("SELECT 1 FROM settings WHERE key = 'family_password_hash'");
  if (existing.rowCount === 0) {
    await setSettingIfMissing("family_password_hash", await hashPassword(c.FAMILY_BOOTSTRAP_PASSWORD));
  }
  await setSettingIfMissing("notifications_enabled", true);
  await setSettingIfMissing("event_title", c.EVENT_TITLE);
  const admin = await db().query("SELECT id FROM users WHERE lower(email) = $1", [c.ADMIN_EMAIL]);
  if (admin.rowCount === 0) {
    const hash = await hashPassword(c.ADMIN_BOOTSTRAP_PASSWORD);
    await db().query(
      `WITH id AS (SELECT gen_random_uuid() AS id)
       INSERT INTO users (id, email, display_name, role, email_verified_at, folder_name, password_hash)
       SELECT id, $1, 'Admin', 'ADMIN', now(), 'Admin__' || left(id::text, 8), $2 FROM id
       ON CONFLICT DO NOTHING`,
      [c.ADMIN_EMAIL, hash],
    );
    log.info("bootstrap.admin_created");
  }
  log.info("bootstrap.ready");
}

export function ensureBooted(): Promise<void> {
  if (!g.__weddingBoot) {
    g.__weddingBoot = run().catch((e) => {
      g.__weddingBootError = (e as Error).message;
      log.error("bootstrap.failed", { error: (e as Error).message });
      g.__weddingBoot = undefined; // allow a later retry
      throw e;
    });
  }
  return g.__weddingBoot;
}

export function bootError() {
  return g.__weddingBootError;
}
