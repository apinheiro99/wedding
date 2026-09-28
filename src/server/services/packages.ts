import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { ZipArchive } from "archiver";
import { db, tx, type Queryable } from "../db";
import { abs } from "../storage";
import { config } from "../config";
import { allocatePackage } from "../domain/rules";
import { enqueue } from "./jobs";
import { publish } from "./events";
import { log } from "../log";

const BUILD_DEBOUNCE_SEC = 45;

/** §16.4 — must run inside the finalize transaction. Locks the uploader's packages. */
export async function assignToPackage(c: Queryable, userId: string, mediaId: string, bytes: number) {
  const target = config().PACKAGE_TARGET_BYTES;
  await c.query("SELECT pg_advisory_xact_lock(hashtext('pkg:' || $1))", [userId]);
  const last = await c.query(
    `SELECT p.id, p.sequence_no,
       coalesce(sum(m.byte_size) FILTER (WHERE m.deleted_at IS NULL), 0)::bigint AS used,
       count(pi.media_id)::int AS items, coalesce(max(pi.ordinal), 0) AS max_ord
     FROM packages p LEFT JOIN package_items pi ON pi.package_id = p.id LEFT JOIN media m ON m.id = pi.media_id
     WHERE p.user_id = $1 GROUP BY p.id ORDER BY p.sequence_no DESC LIMIT 1`,
    [userId],
  );
  const row = last.rows[0];
  let packageId: string, ordinal: number;
  if (allocatePackage(row ? { usedBytes: Number(row.used), itemCount: row.items } : null, bytes, target) === "LAST") {
    packageId = row.id; ordinal = row.max_ord + 1;
  } else {
    const p = await c.query(
      "INSERT INTO packages (user_id, sequence_no, target_bytes, state, dirty_reason) VALUES ($1, $2, $3, 'DIRTY', 'ADD') RETURNING id",
      [userId, (row?.sequence_no ?? 0) + 1, target],
    );
    packageId = p.rows[0].id; ordinal = 1;
  }
  await c.query("INSERT INTO package_items (package_id, media_id, ordinal) VALUES ($1, $2, $3) ON CONFLICT (media_id) DO NOTHING", [packageId, mediaId, ordinal]);
  await c.query("UPDATE media SET package_id = $2 WHERE id = $1", [mediaId, packageId]);
  await markDirty(c, packageId, "ADD");
}

/** DELETE dominates ADD: a package with removed media must not serve its previous version. */
export async function markDirty(c: Queryable, packageId: string, reason: "ADD" | "DELETE") {
  const r = await c.query(
    `UPDATE packages SET state = 'DIRTY', updated_at = now(),
       dirty_reason = CASE WHEN dirty_reason = 'DELETE' OR $2 = 'DELETE' THEN 'DELETE' ELSE 'ADD' END
     WHERE id = $1 RETURNING user_id`,
    [packageId, reason],
  );
  await enqueue("PACKAGE_BUILD", { packageId }, { dedupeKey: `package:${packageId}`, delaySec: BUILD_DEBOUNCE_SEC }, c);
  if (r.rowCount) await publish({ t: "package", userId: r.rows[0].user_id, packageId, state: "DIRTY" }, c);
}

async function snapshot(q: Queryable, packageId: string) {
  const r = await q.query(
    `SELECT m.id, m.relative_path, m.stored_filename, m.byte_size FROM package_items pi JOIN media m ON m.id = pi.media_id
     WHERE pi.package_id = $1 AND m.deleted_at IS NULL ORDER BY pi.ordinal`,
    [packageId],
  );
  const items = r.rows as { id: string; relative_path: string; stored_filename: string; byte_size: number }[];
  const sig = crypto.createHash("sha256").update(items.map((i) => i.id).join(",")).digest("hex");
  return { items, sig };
}

/**
 * §16.7 — builds an immutable new version next to the current one, validates it,
 * then swaps the pointer in a transaction. Never publishes a partial ZIP.
 */
export async function buildPackage(packageId: string): Promise<"BUILT" | "EMPTY" | "CHANGED" | "SKIPPED"> {
  const pre = await db().query("SELECT p.*, u.folder_name FROM packages p JOIN users u ON u.id = p.user_id WHERE p.id = $1", [packageId]);
  const pkg = pre.rows[0];
  if (!pkg) return "SKIPPED";
  if (pkg.state === "READY") return "SKIPPED";
  const { items, sig } = await snapshot(db(), packageId);

  if (items.length === 0) {
    await tx(async (c) => {
      await c.query("UPDATE package_versions SET state = 'RETIRED', retired_at = now() WHERE package_id = $1 AND state = 'READY'", [packageId]);
      await c.query("UPDATE packages SET state = 'READY', dirty_reason = NULL, current_version_id = NULL, updated_at = now() WHERE id = $1", [packageId]);
    });
    await publish({ t: "package", userId: pkg.user_id, packageId, state: "READY" });
    return "EMPTY";
  }

  const v = await db().query(
    `INSERT INTO package_versions (package_id, version_no, state)
     VALUES ($1, coalesce((SELECT max(version_no) FROM package_versions WHERE package_id = $1), 0) + 1, 'BUILDING')
     RETURNING id, version_no`,
    [packageId],
  );
  const { id: versionId, version_no } = v.rows[0];
  await db().query("UPDATE packages SET state = 'BUILDING', updated_at = now() WHERE id = $1 AND state = 'DIRTY'", [packageId]);
  await publish({ t: "package", userId: pkg.user_id, packageId, state: "BUILDING" });

  const rel = `packages/${pkg.user_id}/${String(pkg.sequence_no).padStart(2, "0")}_${packageId}_v${version_no}.zip`;
  const tmp = abs(rel + ".partial");
  await fsp.mkdir(path.dirname(tmp), { recursive: true });
  const started = Date.now();
  try {
    await writeZip(tmp, items.map((i) => ({ path: abs(i.relative_path), name: i.stored_filename })));
    const stat = await fsp.stat(tmp);
    const expectedMin = items.reduce((s, i) => s + Number(i.byte_size), 0);
    if (stat.size < expectedMin) throw new Error(`zip too small: ${stat.size} < ${expectedMin}`);
    const checksum = await fileSha256(tmp);
    await fsp.rename(tmp, abs(rel));

    const outcome = await tx(async (c) => {
      await c.query("SELECT 1 FROM packages WHERE id = $1 FOR UPDATE", [packageId]);
      const now = await snapshot(c, packageId);
      if (now.sig !== sig) {
        // items changed while building: discard, stay dirty, rebuild soon
        await c.query("UPDATE package_versions SET state = 'FAILED', retired_at = now() WHERE id = $1", [versionId]);
        return "CHANGED" as const;
      }
      await c.query("UPDATE package_versions SET state = 'RETIRED', retired_at = now() WHERE package_id = $1 AND state = 'READY'", [packageId]);
      await c.query(
        "UPDATE package_versions SET state = 'READY', relative_path = $2, byte_size = $3, checksum = $4, item_count = $5 WHERE id = $1",
        [versionId, rel, stat.size, checksum, items.length],
      );
      await c.query(
        "UPDATE packages SET state = 'READY', dirty_reason = NULL, current_version_id = $2, updated_at = now() WHERE id = $1",
        [packageId, versionId],
      );
      return "BUILT" as const;
    });
    if (outcome === "CHANGED") {
      await fsp.rm(abs(rel), { force: true });
      await db().query("UPDATE packages SET state = 'DIRTY', updated_at = now() WHERE id = $1 AND state = 'BUILDING'", [packageId]);
      await enqueue("PACKAGE_BUILD", { packageId }, { dedupeKey: `package:${packageId}`, delaySec: 5 });
      return "CHANGED";
    }
    log.info("package.built", { packageId, version: version_no, items: items.length, bytes: stat.size, ms: Date.now() - started });
    await publish({ t: "package", userId: pkg.user_id, packageId, state: "READY" });
    return "BUILT";
  } catch (e) {
    await fsp.rm(tmp, { force: true });
    await db().query("UPDATE package_versions SET state = 'FAILED', retired_at = now() WHERE id = $1", [versionId]);
    await db().query("UPDATE packages SET state = 'FAILED', updated_at = now() WHERE id = $1", [packageId]);
    await publish({ t: "package", userId: pkg.user_id, packageId, state: "FAILED" });
    throw e;
  }
}

/** STORE entries (media is already compressed); ZIP64 automatically when needed. */
export function writeZip(dest: string, entries: { path: string; name: string }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    const zip = new ZipArchive({ store: true });
    out.on("close", resolve);
    out.on("error", reject);
    zip.on("error", reject);
    zip.on("warning", reject);
    zip.pipe(out);
    for (const e of entries) zip.file(e.path, { name: e.name });
    zip.finalize();
  });
}

export function streamZip(entries: { path: string; name: string }[]) {
  const zip = new ZipArchive({ store: true });
  for (const e of entries) zip.file(e.path, { name: e.name });
  zip.finalize();
  return zip;
}

export async function fileSha256(p: string): Promise<string> {
  const h = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(p, { highWaterMark: 4 * 1024 * 1024 })) h.update(chunk);
  return h.digest("hex");
}

/** Downloads page: every uploader with their packages (§17). */
export async function listPackages() {
  const r = await db().query(
    `SELECT u.id AS user_id, u.display_name,
       (SELECT count(*) FILTER (WHERE media_kind = 'IMAGE')::int FROM media WHERE uploader_user_id = u.id AND deleted_at IS NULL) AS photos,
       (SELECT count(*) FILTER (WHERE media_kind = 'VIDEO')::int FROM media WHERE uploader_user_id = u.id AND deleted_at IS NULL) AS videos,
       (SELECT count(*) FILTER (WHERE media_kind = 'OTHER')::int FROM media WHERE uploader_user_id = u.id AND deleted_at IS NULL) AS others,
       (SELECT coalesce(sum(byte_size), 0)::bigint FROM media WHERE uploader_user_id = u.id AND deleted_at IS NULL) AS bytes,
       coalesce(json_agg(json_build_object(
         'id', p.id, 'seq', p.sequence_no, 'state', p.state, 'dirtyReason', p.dirty_reason,
         'versionBytes', pv.byte_size, 'versionItems', pv.item_count, 'hasVersion', pv.id IS NOT NULL
       ) ORDER BY p.sequence_no) FILTER (WHERE p.id IS NOT NULL), '[]') AS packages
     FROM users u
     LEFT JOIN packages p ON p.user_id = u.id
     LEFT JOIN package_versions pv ON pv.id = p.current_version_id
     WHERE EXISTS (SELECT 1 FROM media m WHERE m.uploader_user_id = u.id AND m.deleted_at IS NULL)
     GROUP BY u.id ORDER BY u.display_name, u.id`,
  );
  return r.rows.map((row) => ({
    userId: row.user_id, displayName: row.display_name, photos: row.photos, videos: row.videos, others: row.others, bytes: Number(row.bytes),
    packages: (row.packages as any[])
      .map((p) => ({
        id: p.id, label: String(p.seq).padStart(2, "0"),
        // §16.8: additions may keep serving the previous version; deletions may not.
        available: p.hasVersion && (p.state === "READY" || p.dirtyReason === "ADD" || (p.state !== "FAILED" && p.dirtyReason !== "DELETE")),
        updating: p.state !== "READY",
        failed: p.state === "FAILED" && !p.hasVersion,
        bytes: p.versionBytes, items: p.versionItems, state: p.state,
        empty: p.state === "READY" && !p.hasVersion,
      }))
      .filter((p) => !p.empty),
  }));
}

/** Resolves the version to serve at request start; that file stays valid until cleanup. */
export async function resolveDownload(packageId: string) {
  const r = await db().query(
    `SELECT p.sequence_no, p.state, p.dirty_reason, u.display_name, pv.id AS version_id, pv.relative_path, pv.byte_size
     FROM packages p JOIN users u ON u.id = p.user_id LEFT JOIN package_versions pv ON pv.id = p.current_version_id
     WHERE p.id = $1`,
    [packageId],
  );
  const p = r.rows[0];
  if (!p || !p.version_id) return null;
  if (p.state !== "READY" && p.dirty_reason === "DELETE") return null;
  return { versionId: p.version_id as string, path: abs(p.relative_path), size: Number(p.byte_size), filename: `${p.display_name} - ${String(p.sequence_no).padStart(2, "0")}.zip` };
}
