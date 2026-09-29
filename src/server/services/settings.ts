import type { Queryable } from "../db";
import { db } from "../db";

export type Settings = {
  family_login: string;
  family_password_hash: string;
  notifications_enabled: boolean;
  event_title: string;
  hero_version: number;
  hero_versions: Record<string, number>;
  log_level: "trace" | "debug" | "info" | "warn" | "error";
  log_retain_days: number;
  report_email: string;
};

export async function getSetting<K extends keyof Settings>(key: K, q: Queryable = db()): Promise<Settings[K] | undefined> {
  const r = await q.query("SELECT value FROM settings WHERE key = $1", [key]);
  return r.rows[0]?.value;
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K], q: Queryable = db()) {
  await q.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

export async function setSettingIfMissing<K extends keyof Settings>(key: K, value: Settings[K], q: Queryable = db()) {
  await q.query("INSERT INTO settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO NOTHING", [
    key, JSON.stringify(value),
  ]);
}
