import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { db, tx, type Queryable } from "../db";
import { abs, collisionName, sanitizeFilename } from "../storage";
import { canonicalDate, dedupeDecision, mediaKindFrom } from "../domain/rules";
import { assignToPackage, fileSha256, markDirty } from "./packages";
import { enqueue } from "./jobs";
import { publish } from "./events";
import { forbidden, notFound } from "../http";
import { log } from "../log";

async function detectMime(file: string): Promise<string | null> {
  const { fileTypeFromFile } = await import("file-type");
  try { return (await fileTypeFromFile(file))?.mime ?? null; } catch { return null; }
}

/**
 * §11 — only publishes media after bytes complete, size matches, SHA-256 computed,
 * dedupe resolved, original linked into its final place, and the DB row committed.
 * Idempotent: re-running on a terminal upload is a no-op.
 */
export async function finalizeUpload(uploadId: string) {
  const r = await db().query("SELECT u.*, us.folder_name FROM uploads u JOIN users us ON us.id = u.user_id WHERE u.id = $1", [uploadId]);
  const up = r.rows[0];
  if (!up || !["VERIFYING", "FINALIZING"].includes(up.state)) return up?.state ?? "MISSING";
  const staging = abs(`staging/${uploadId}/data`);
  const emit = (state: string, mediaId?: string | null, reason?: string | null) =>
    publish({ t: "upload", userId: up.user_id, uploadId, state, mediaId, reason });

  const size = await fsp.stat(staging).then((s) => s.size).catch(() => -1);
  if (size !== Number(up.expected_size)) {
    await db().query("UPDATE uploads SET state = 'FAILED', failure_reason = 'SIZE_MISMATCH', updated_at = now() WHERE id = $1", [uploadId]);
    await db().query("INSERT INTO audit_events (type, user_id, data) VALUES ('UPLOAD_ERROR', $1, $2)", [up.user_id, { uploadId, reason: "SIZE_MISMATCH" }]);
    await emit("FAILED", null, "SIZE_MISMATCH");
    return "FAILED";
  }
  await db().query("UPDATE uploads SET state = 'FINALIZING', updated_at = now() WHERE id = $1", [uploadId]);
  const sha = await fileSha256(staging);
  const mimeDetected = await detectMime(staging);
  const kind = mediaKindFrom(mimeDetected ?? up.mime_reported, up.original_filename);
  const userDir = `originals/users/${up.folder_name}`;
  await fsp.mkdir(abs(userDir), { recursive: true });

  let linkedPath: string | null = null;
  try {
    const result = await tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext('sha:' || $1))", [sha]);
      const ex = await c.query("SELECT id, deleted_at FROM media WHERE sha256 = $1 FOR UPDATE", [sha]);
      const d = dedupeDecision(ex.rows[0] ? { deletedAt: ex.rows[0].deleted_at } : null);
      if (d === "DUPLICATE_ACTIVE") {
        await c.query("UPDATE uploads SET state = 'DUPLICATE', media_id = $2, completed_at = now(), updated_at = now() WHERE id = $1", [uploadId, ex.rows[0].id]);
        await c.query("INSERT INTO audit_events (type, user_id, data) VALUES ('DUPLICATE_DETECTED', $1, $2)", [up.user_id, { mediaId: ex.rows[0].id }]);
        return { state: "DUPLICATE", mediaId: ex.rows[0].id as string };
      }
      if (d === "DUPLICATE_SOFT_DELETED") {
        await restoreMediaTx(c, ex.rows[0].id, up.user_id, "REUPLOAD");
        await c.query("UPDATE uploads SET state = 'RESTORED', media_id = $2, completed_at = now(), updated_at = now() WHERE id = $1", [uploadId, ex.rows[0].id]);
        return { state: "RESTORED", mediaId: ex.rows[0].id as string };
      }
      // NEW: pick a free name in the uploader's folder; link() never overwrites
      const base = sanitizeFilename(up.original_filename);
      let stored = "";
      for (let n = 0; n < 10000; n++) {
        const candidate = collisionName(base, n);
        const taken = await c.query("SELECT 1 FROM media WHERE uploader_user_id = $1 AND lower(stored_filename) = lower($2)", [up.user_id, candidate]);
        if (taken.rowCount) continue;
        try {
          await fsp.link(staging, abs(`${userDir}/${candidate}`));
        } catch (e: any) {
          if (e.code === "EEXIST") continue;
          if (e.code === "EPERM" || e.code === "EXDEV" || e.code === "ENOTSUP") {
            await fsp.copyFile(staging, abs(`${userDir}/${candidate}`), fs.constants.COPYFILE_EXCL);
          } else throw e;
        }
        stored = candidate;
        linkedPath = abs(`${userDir}/${candidate}`);
        break;
      }
      if (!stored) throw new Error("no free filename");
      const uploadAt = new Date();
      const date = canonicalDate({ clientFile: up.client_last_modified, upload: uploadAt });
      const ins = await c.query(
        `INSERT INTO media (uploader_user_id, sha256, original_filename, stored_filename, relative_path, byte_size,
           mime_reported, mime_detected, media_kind, capture_at, capture_at_source, sort_at, client_last_modified,
           thumbnail_state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13) RETURNING id`,
        [up.user_id, sha, up.original_filename, stored, `${userDir}/${stored}`, size, up.mime_reported, mimeDetected, kind,
          date.source, date.at, up.client_last_modified, kind === "OTHER" ? "UNSUPPORTED" : "PENDING"],
      );
      const mediaId = ins.rows[0].id as string;
      await c.query("UPDATE uploads SET state = 'COMPLETE', media_id = $2, received_size = $3, completed_at = now(), updated_at = now() WHERE id = $1", [uploadId, mediaId, size]);
      await assignToPackage(c, up.user_id, mediaId, size);
      await c.query("INSERT INTO notification_activity (user_id, media_id, media_kind, byte_size) VALUES ($1, $2, $3, $4)", [up.user_id, mediaId, kind, size]);
      await enqueue("MEDIA_PROCESS", { mediaId }, { dedupeKey: `process:${mediaId}`, priority: 50 }, c);
      return { state: "COMPLETE", mediaId };
    });
    await fsp.rm(abs(`staging/${uploadId}`), { recursive: true, force: true }).catch(() => {});
    await emit(result.state, result.mediaId);
    if (result.state === "COMPLETE") await publish({ t: "media", mediaId: result.mediaId, userId: up.user_id, change: "added" });
    return result.state;
  } catch (e) {
    if (linkedPath) await fsp.rm(linkedPath, { force: true }); // never leave an unpublished original behind
    throw e;
  }
}

async function restoreMediaTx(c: Queryable, mediaId: string, byUserId: string, why: "REUPLOAD" | "ADMIN") {
  const r = await c.query("UPDATE media SET deleted_at = NULL, deleted_by = NULL, updated_at = now() WHERE id = $1 AND deleted_at IS NOT NULL RETURNING package_id, uploader_user_id, thumbnail_state", [mediaId]);
  if (!r.rowCount) return false;
  const m = r.rows[0];
  await c.query("INSERT INTO audit_events (type, user_id, data) VALUES ('MEDIA_RESTORED', $1, $2)", [byUserId, { mediaId, why }]);
  if (m.package_id) await markDirty(c, m.package_id, "ADD");
  if (m.thumbnail_state !== "READY" && m.thumbnail_state !== "UNSUPPORTED") await enqueue("MEDIA_PROCESS", { mediaId }, { dedupeKey: `process:${mediaId}` }, c);
  await publish({ t: "media", mediaId, userId: m.uploader_user_id, change: "restored" }, c);
  return true;
}

export function restoreMedia(mediaId: string, byUserId: string, why: "REUPLOAD" | "ADMIN") {
  return tx((c) => restoreMediaTx(c, mediaId, byUserId, why));
}

/** §15 — owner (or admin) soft delete. The original stays on disk. */
export async function softDelete(mediaId: string, actor: { id: string; isAdmin: boolean }) {
  return tx(async (c) => {
    const r = await c.query("SELECT uploader_user_id, package_id, deleted_at FROM media WHERE id = $1 FOR UPDATE", [mediaId]);
    const m = r.rows[0];
    if (!m) throw notFound();
    if (m.uploader_user_id !== actor.id && !actor.isAdmin) throw forbidden("Só quem enviou pode excluir.");
    if (m.deleted_at) return;
    await c.query("UPDATE media SET deleted_at = now(), deleted_by = $2, updated_at = now() WHERE id = $1", [mediaId, actor.id]);
    await c.query("INSERT INTO audit_events (type, user_id, data) VALUES ('MEDIA_DELETED', $1, $2)", [actor.id, { mediaId }]);
    if (m.package_id) await markDirty(c, m.package_id, "DELETE");
    await publish({ t: "media", mediaId, userId: m.uploader_user_id, change: "deleted" }, c);
  });
}

// ---------- queries ----------

export type ListOpts = { order: "asc" | "desc"; uploader?: string | null; cursor?: string | null; limit: number; includeDeleted?: boolean; onlyDeleted?: boolean };

function encodeCursor(sortAt: Date, id: string) { return Buffer.from(`${sortAt.toISOString()}|${id}`).toString("base64url"); }
function decodeCursor(c: string) {
  const [t, id] = Buffer.from(c, "base64url").toString().split("|");
  if (!t || !/^[0-9a-f-]{36}$/.test(id ?? "") || isNaN(Date.parse(t))) return null;
  return { t: new Date(t), id };
}

/** Cursor-based gallery page (§28.1). */
export async function listMedia(o: ListOpts) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (o.onlyDeleted) where.push("m.deleted_at IS NOT NULL");
  else if (!o.includeDeleted) where.push("m.deleted_at IS NULL");
  if (o.uploader) { params.push(o.uploader); where.push(`m.uploader_user_id = $${params.length}`); }
  const cur = o.cursor ? decodeCursor(o.cursor) : null;
  if (cur) {
    params.push(cur.t, cur.id);
    where.push(`(m.sort_at, m.id) ${o.order === "asc" ? ">" : "<"} ($${params.length - 1}, $${params.length})`);
  }
  params.push(o.limit + 1);
  const dir = o.order === "asc" ? "ASC" : "DESC";
  const r = await db().query(
    `SELECT m.id, m.media_kind, m.sort_at, m.capture_at_source, m.width, m.height, m.duration_ms, m.thumbnail_state,
       m.original_filename, m.byte_size, m.deleted_at, m.uploader_user_id, u.display_name
     FROM media m JOIN users u ON u.id = m.uploader_user_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY m.sort_at ${dir}, m.id ${dir} LIMIT $${params.length}`,
    params,
  );
  const rows = r.rows.slice(0, o.limit);
  const last = rows[rows.length - 1];
  return {
    items: rows.map((m) => ({
      id: m.id, kind: m.media_kind, takenAt: m.sort_at, dateSource: m.capture_at_source,
      width: m.width, height: m.height, durationMs: m.duration_ms, thumb: m.thumbnail_state,
      filename: m.original_filename, bytes: Number(m.byte_size), deleted: !!m.deleted_at,
      uploader: { id: m.uploader_user_id, name: m.display_name },
    })),
    nextCursor: r.rows.length > o.limit && last ? encodeCursor(last.sort_at, last.id) : null,
  };
}

export async function mediaDetail(id: string, viewer: { id: string; isAdmin: boolean }) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const r = await db().query(
    `SELECT m.*, u.display_name FROM media m JOIN users u ON u.id = m.uploader_user_id WHERE m.id = $1`, [id]);
  const m = r.rows[0];
  if (!m || (m.deleted_at && !viewer.isAdmin)) throw notFound();
  const meta = m.metadata_json ?? {};
  return {
    id: m.id, kind: m.media_kind, filename: m.original_filename, bytes: Number(m.byte_size),
    mime: m.mime_detected ?? m.mime_reported, takenAt: m.sort_at, dateSource: m.capture_at_source,
    width: m.width, height: m.height, durationMs: m.duration_ms, thumb: m.thumbnail_state,
    uploader: { id: m.uploader_user_id, name: m.display_name },
    camera: [meta.make, meta.model].filter(Boolean).join(" ") || null,
    hasGps: meta.latitude != null,
    deleted: !!m.deleted_at,
    canDelete: m.uploader_user_id === viewer.id || viewer.isAdmin,
    uploadedAt: m.created_at,
  };
}

/** Albums by uploader (§14.2). */
export async function listAlbums() {
  const r = await db().query(
    `SELECT u.id, u.display_name, count(m.id)::int AS total,
       count(m.id) FILTER (WHERE m.media_kind = 'VIDEO')::int AS videos,
       (SELECT id FROM media c WHERE c.uploader_user_id = u.id AND c.deleted_at IS NULL AND c.thumbnail_state = 'READY' ORDER BY c.sort_at DESC LIMIT 1) AS cover_id,
       (SELECT array_agg(id) FROM (SELECT id FROM media c WHERE c.uploader_user_id = u.id AND c.deleted_at IS NULL AND c.thumbnail_state = 'READY' ORDER BY c.sort_at DESC LIMIT 4) s) AS preview_ids
     FROM users u JOIN media m ON m.uploader_user_id = u.id AND m.deleted_at IS NULL
     GROUP BY u.id ORDER BY u.display_name, u.id`,
  );
  // duplicate names get a discreet disambiguator (short id), never the e-mail
  const counts = new Map<string, number>();
  for (const a of r.rows) counts.set(a.display_name.toLowerCase(), (counts.get(a.display_name.toLowerCase()) ?? 0) + 1);
  return r.rows.map((a) => ({
    id: a.id, name: a.display_name, total: a.total, videos: a.videos, photos: a.total - a.videos,
    coverId: a.cover_id, previewIds: a.preview_ids ?? [],
    disambiguator: (counts.get(a.display_name.toLowerCase()) ?? 0) > 1 ? `#${a.id.slice(0, 4)}` : null,
  }));
}

export async function mediaFile(id: string, viewer: { isAdmin: boolean }) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const r = await db().query("SELECT relative_path, original_filename, byte_size, mime_detected, mime_reported, deleted_at FROM media WHERE id = $1", [id]);
  const m = r.rows[0];
  if (!m || (m.deleted_at && !viewer.isAdmin)) throw notFound();
  return { path: abs(m.relative_path), filename: m.original_filename as string, size: Number(m.byte_size), mime: (m.mime_detected ?? m.mime_reported ?? "application/octet-stream") as string };
}

export async function counts() {
  const r = await db().query(
    `SELECT count(*) FILTER (WHERE media_kind = 'IMAGE')::int AS photos, count(*) FILTER (WHERE media_kind = 'VIDEO')::int AS videos,
       count(*) FILTER (WHERE media_kind = 'OTHER')::int AS others FROM media WHERE deleted_at IS NULL`);
  return r.rows[0] as { photos: number; videos: number; others: number };
}

export function thumbPath(mediaId: string, size: "sm" | "lg") {
  return abs(`thumbnails/${mediaId}/${size}.webp`);
}

void log; void path;
