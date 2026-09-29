import { log } from "../log";
import { db } from "../db";
import { config } from "../config";
import { isValidEmail } from "../domain/otp";
import { badRequest, notFound } from "../http";
import { adminStats } from "./notifications";
import { getSetting, setSetting, type Settings } from "./settings";
import { applyLogSettings } from "./logsettings";
import { markDirty } from "./packages";

export async function overview() {
  const stats = await adminStats(24);
  const pk = await db().query("SELECT state, count(*)::int AS n FROM packages GROUP BY state");
  return {
    stats, packages: Object.fromEntries(pk.rows.map((r) => [r.state, r.n])),
    settings: { notificationsEnabled: (await getSetting("notifications_enabled")) ?? true, eventTitle: await getSetting("event_title"), familyLogin: await getSetting("family_login"), logLevel: (await getSetting("log_level")) ?? null, logRetainDays: (await getSetting("log_retain_days")) ?? 7, reportEmail: (await getSetting("report_email")) ?? config().REPORT_EMAIL ?? "" },
  };
}

export async function listUsers() {
  const r = await db().query(
    `SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at,
       count(m.id) FILTER (WHERE m.deleted_at IS NULL)::int AS active, count(m.id) FILTER (WHERE m.deleted_at IS NOT NULL)::int AS deleted,
       coalesce(sum(m.byte_size) FILTER (WHERE m.deleted_at IS NULL), 0)::bigint AS bytes,
       (SELECT max(last_seen_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
     FROM users u LEFT JOIN media m ON m.uploader_user_id = u.id GROUP BY u.id ORDER BY u.created_at`);
  return r.rows.map((u) => ({ id: u.id, email: u.email, displayName: u.display_name, role: u.role, status: u.status, createdAt: u.created_at, active: u.active, deleted: u.deleted, bytes: Number(u.bytes), lastSeen: u.last_seen }));
}

export async function updateUser(id: string, p: { displayName?: string; status?: "ACTIVE" | "DISABLED" }) {
  if (p.displayName !== undefined) {
    const n = p.displayName.trim().replace(/\s+/g, " ");
    if (!n || n.length > 60) throw badRequest("Nome inválido.");
    await db().query("UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1", [id, n]);
  }
  if (p.status) {
    const r = await db().query("UPDATE users SET status = $2, updated_at = now() WHERE id = $1 AND role = 'USER' RETURNING id", [id, p.status]);
    if (!r.rowCount) throw badRequest("Não é possível alterar este usuário.");
    if (p.status === "DISABLED") await db().query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
  }
}

export async function listJobs(state: string | null) {
  const r = await db().query(
    `SELECT id, type, payload, state, attempts, max_attempts, last_error, created_at, available_at, completed_at FROM jobs
     WHERE ($1::text IS NULL OR state = $1) ORDER BY id DESC LIMIT 200`, [state]);
  const c = await db().query("SELECT state, count(*)::int AS n FROM jobs GROUP BY state");
  return { jobs: r.rows, counts: Object.fromEntries(c.rows.map((x) => [x.state, x.n])) };
}

export async function listPackagesAdmin() {
  const r = await db().query(
    `SELECT p.id, p.sequence_no, p.state, p.dirty_reason, p.updated_at, u.display_name, pv.version_no, pv.byte_size, pv.item_count,
       (SELECT count(*)::int FROM package_versions x WHERE x.package_id = p.id) AS versions
     FROM packages p JOIN users u ON u.id = p.user_id LEFT JOIN package_versions pv ON pv.id = p.current_version_id
     ORDER BY u.display_name, p.sequence_no`);
  return r.rows.map((p) => ({ id: p.id, label: String(p.sequence_no).padStart(2, "0"), state: p.state, dirtyReason: p.dirty_reason, updatedAt: p.updated_at, owner: p.display_name, version: p.version_no, bytes: p.byte_size != null ? Number(p.byte_size) : null, items: p.item_count, versions: p.versions }));
}

export async function rebuildPackage(id: string) {
  const r = await db().query("SELECT 1 FROM packages WHERE id = $1", [id]);
  if (!r.rowCount) throw notFound();
  await markDirty(db(), id, "ADD");
}

export async function updateSettings(p: { notificationsEnabled?: boolean; eventTitle?: string; logLevel?: Settings["log_level"]; logRetainDays?: number; reportEmail?: string }) {
  log.info("admin.settings_changed", { keys: Object.keys(p) });
  if (p.reportEmail !== undefined) {
    const e = p.reportEmail.trim().toLowerCase();
    if (!isValidEmail(e) || /\.(local|invalid|test|example)$/.test(e)) throw badRequest("E-mail inválido para o relatório.");
    await setSetting("report_email", e);
  }
  if (p.logLevel !== undefined) await setSetting("log_level", p.logLevel);
  if (p.logRetainDays !== undefined) await setSetting("log_retain_days", p.logRetainDays);
  if (p.logLevel !== undefined || p.logRetainDays !== undefined) await applyLogSettings();
  if (p.notificationsEnabled !== undefined) await setSetting("notifications_enabled", p.notificationsEnabled);
  if (p.eventTitle !== undefined) {
    const t = p.eventTitle.trim();
    if (!t || t.length > 80) throw badRequest("Título inválido.");
    await setSetting("event_title", t);
  }
}
