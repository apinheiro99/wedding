import fsp from "node:fs/promises";
import { db, tx } from "../db";
import { config } from "../config";
import { digestFor, formatBytes, type Activity } from "../domain/rules";
import { sendAdminDailyReport, sendNewMediaDigest } from "../email";
import { getSetting } from "./settings";
import { abs, dirSize, diskFree } from "../storage";
import { log } from "../log";

/**
 * §19 — when the pending activity has been quiet for DIGEST_QUIET_MINUTES, seal it into a digest
 * and deliver per recipient (excluding their own uploads). Deliveries are recorded so retries never resend.
 */
export async function runDigest(): Promise<number> {
  const enabled = (await getSetting("notifications_enabled")) ?? true;
  const quiet = config().DIGEST_QUIET_MINUTES;

  const digestId = await tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(742002)");
    const r = await c.query(
      `SELECT count(*)::int AS n, max(created_at) AS last FROM notification_activity WHERE digest_id IS NULL`);
    if (!r.rows[0].n || new Date(r.rows[0].last).getTime() > Date.now() - quiet * 60_000) return null;
    const d = await c.query("INSERT INTO notification_digests DEFAULT VALUES RETURNING id");
    await c.query("UPDATE notification_activity SET digest_id = $1 WHERE digest_id IS NULL", [d.rows[0].id]);
    if (enabled) {
      await c.query(
        `INSERT INTO notification_deliveries (digest_id, recipient_user_id)
         SELECT $1, id FROM users WHERE status = 'ACTIVE' AND email_verified_at IS NOT NULL`, [d.rows[0].id]);
    }
    return d.rows[0].id as string;
  });
  // also retry unsent deliveries from earlier digests
  const pending = await db().query(
    `SELECT nd.digest_id, u.id, u.email FROM notification_deliveries nd JOIN users u ON u.id = nd.recipient_user_id
     WHERE nd.sent_at IS NULL AND (nd.digest_id = $1 OR nd.error IS NOT NULL) LIMIT 500`, [digestId]);
  let sent = 0;
  const cache = new Map<string, Activity[]>();
  for (const p of pending.rows) {
    if (!cache.has(p.digest_id)) {
      const a = await db().query(
        `SELECT na.user_id, u.display_name, na.media_kind, na.byte_size FROM notification_activity na
         JOIN users u ON u.id = na.user_id JOIN media m ON m.id = na.media_id
         WHERE na.digest_id = $1 AND m.deleted_at IS NULL`, [p.digest_id]);
      cache.set(p.digest_id, a.rows.map((x) => ({ userId: x.user_id, userName: x.display_name, kind: x.media_kind, bytes: Number(x.byte_size) })));
    }
    const lines = digestFor(p.id, cache.get(p.digest_id)!);
    try {
      if (lines.length) await sendNewMediaDigest(p.email, lines, formatBytes);
      await db().query("UPDATE notification_deliveries SET sent_at = now(), error = NULL WHERE digest_id = $1 AND recipient_user_id = $2 AND sent_at IS NULL", [p.digest_id, p.id]);
      if (lines.length) sent++;
    } catch (e) {
      await db().query("UPDATE notification_deliveries SET error = $3 WHERE digest_id = $1 AND recipient_user_id = $2", [p.digest_id, p.id, (e as Error).message.slice(0, 500)]);
      await db().query("INSERT INTO audit_events (type, data) VALUES ('EMAIL_FAILED', $1)", [{ kind: "digest" }]);
    }
  }
  return sent;
}

export async function adminStats(sinceHours = 24) {
  const s = `now() - make_interval(hours => ${Number(sinceHours)})`;
  const q = async (sql: string) => (await db().query(sql)).rows[0];
  const users = await q(`SELECT count(*)::int AS total, count(*) FILTER (WHERE created_at > ${s})::int AS new FROM users WHERE role = 'USER'`);
  const media = await q(`SELECT count(*) FILTER (WHERE created_at > ${s})::int AS uploads,
      count(*) FILTER (WHERE created_at > ${s} AND media_kind = 'IMAGE')::int AS photos,
      count(*) FILTER (WHERE created_at > ${s} AND media_kind = 'VIDEO')::int AS videos,
      count(*) FILTER (WHERE created_at > ${s} AND media_kind = 'OTHER')::int AS others,
      coalesce(sum(byte_size) FILTER (WHERE created_at > ${s}), 0)::bigint AS bytes_new,
      count(*) FILTER (WHERE deleted_at IS NULL)::int AS total_active,
      count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS total_deleted,
      coalesce(sum(byte_size), 0)::bigint AS originals_bytes FROM media`);
  const ev = await q(`SELECT count(*) FILTER (WHERE type = 'DUPLICATE_DETECTED')::int AS dups,
      count(*) FILTER (WHERE type = 'MEDIA_RESTORED')::int AS restored,
      count(*) FILTER (WHERE type = 'UPLOAD_ERROR')::int AS upload_errors,
      count(*) FILTER (WHERE type = 'EMAIL_FAILED')::int AS email_failed FROM audit_events WHERE created_at > ${s}`);
  const up = await q(`SELECT count(*) FILTER (WHERE state = 'FAILED')::int AS failed, count(*) FILTER (WHERE state = 'UPLOADING')::int AS active FROM uploads WHERE updated_at > ${s}`);
  const dl = await q(`SELECT count(*)::int AS n FROM download_events WHERE started_at > ${s}`);
  const jobs = await q(`SELECT count(*) FILTER (WHERE state = 'FAILED')::int AS failed, count(*) FILTER (WHERE state = 'PENDING' AND attempts > 0)::int AS retrying,
      count(*) FILTER (WHERE state = 'PENDING')::int AS pending, count(*) FILTER (WHERE state = 'RUNNING')::int AS running FROM jobs`);
  const pk = await q(`SELECT coalesce(sum(byte_size) FILTER (WHERE state IN ('READY','RETIRED')), 0)::bigint AS bytes FROM package_versions`);
  return {
    users, media: { ...media, bytes_new: Number(media.bytes_new), originals_bytes: Number(media.originals_bytes) },
    events: ev, uploads: { ...up, errors: ev.upload_errors }, downloads: dl.n, jobs, packagesBytes: Number(pk.bytes),
    thumbsBytes: await dirSize("thumbnails"), disk: await diskFree(),
  };
}

/** §20 — once per day (after 08:00 server time), recorded in daily_reports so it never double-sends. */
export async function runDailyReport(force = false) {
  const today = new Date().toISOString().slice(0, 10);
  if (!force && new Date().getHours() < 8) return false;
  const claim = await db().query("INSERT INTO daily_reports (report_date) VALUES ($1) ON CONFLICT DO NOTHING RETURNING report_date", [today]);
  if (!claim.rowCount && !force) {
    const r = await db().query("SELECT sent_at FROM daily_reports WHERE report_date = $1", [today]);
    if (r.rows[0]?.sent_at) return false;
  }
  const s = await adminStats(24);
  const fb = formatBytes;
  const rows: [string, string][] = [
    ["Novos usuários (24h)", String(s.users.new)], ["Usuários totais", String(s.users.total)],
    ["Uploads concluídos", String(s.media.uploads)], ["Fotos novas", String(s.media.photos)], ["Vídeos novos", String(s.media.videos)],
    ["Outros arquivos", String(s.media.others)], ["Volume recebido", fb(s.media.bytes_new)],
    ["Duplicatas detectadas", String(s.events.dups)], ["Restaurados de exclusão", String(s.events.restored)],
    ["Erros de upload", String(s.uploads.errors)], ["Total de mídias", String(s.media.total_active)],
    ["Originais armazenados", fb(s.media.originals_bytes)], ["Thumbnails/previews", fb(s.thumbsBytes)],
    ["Pacotes ZIP", fb(s.packagesBytes)], ["Downloads realizados", String(s.downloads)],
    ["Jobs falhos / em retry", `${s.jobs.failed} / ${s.jobs.retrying}`],
    ["Espaço livre", s.disk ? fb(s.disk.free) : "?"],
    ["Saúde", s.jobs.failed === 0 ? "OK" : "Atenção: jobs falhos"],
  ];
  const to = (await getSetting("report_email")) ?? config().REPORT_EMAIL ?? config().ADMIN_EMAIL;
  if (/\.(local|invalid|test|example)$/i.test(to)) {
    log.warn("daily_report.skipped", { reason: "recipient is not a deliverable address; set REPORT_EMAIL", to });
  } else {
    await sendAdminDailyReport(to, rows);
  }
  await db().query("UPDATE daily_reports SET sent_at = now() WHERE report_date = $1", [today]);
  return true;
}

/** Temp/stale cleanup. Old package versions are removed only after a safe period. */
export async function runCleanup() {
  const stale = await db().query(
    "UPDATE uploads SET state = 'CANCELLED', failure_reason = 'STALE', updated_at = now() WHERE state = 'UPLOADING' AND updated_at < now() - interval '14 days' RETURNING id");
  for (const u of stale.rows) await fsp.rm(abs(`staging/${u.id}`), { recursive: true, force: true }).catch(() => {});
  const old = await db().query(
    "SELECT id, relative_path FROM package_versions WHERE state IN ('RETIRED') AND retired_at < now() - interval '12 hours' AND relative_path IS NOT NULL");
  for (const v of old.rows) {
    await fsp.rm(abs(v.relative_path), { force: true });
    await db().query("UPDATE package_versions SET state = 'REMOVED' WHERE id = $1", [v.id]);
  }
  await db().query("DELETE FROM otp_challenges WHERE created_at < now() - interval '2 days'");
  await db().query("DELETE FROM onboarding_grants WHERE expires_at < now()");
  await db().query("DELETE FROM sessions WHERE expires_at < now() - interval '7 days'");
  await db().query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'");
  await db().query("DELETE FROM jobs WHERE state = 'DONE' AND completed_at < now() - interval '7 days'");
  log.info("cleanup.done", { staleUploads: stale.rowCount, removedVersions: old.rowCount });
}
