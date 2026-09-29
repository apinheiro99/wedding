import { log } from "../log";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { db, tx } from "../db";
import { abs } from "../storage";
import { HttpError, badRequest, notFound } from "../http";
import { dedupeDecision, TERMINAL, type UploadState } from "../domain/rules";
import { enqueue } from "./jobs";
import { publish } from "./events";
import { restoreMedia } from "./media";
import { config } from "../config";

export const stagingPath = (uploadId: string) => abs(`staging/${uploadId}/data`);

/** Pre-upload check (§10.3). A soft-deleted duplicate is restored right away. */
export async function checkHash(userId: string, sha256: string): Promise<{ status: "NEW" | "DUPLICATE_ACTIVE" | "RESTORED"; mediaId?: string }> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw badRequest("Hash inválido.");
  const r = await db().query("SELECT id, deleted_at FROM media WHERE sha256 = $1", [sha256]);
  const d = dedupeDecision(r.rows[0] ? { deletedAt: r.rows[0].deleted_at } : null);
  if (d === "NEW") return { status: "NEW" };
  const mediaId = r.rows[0].id as string;
  if (d === "DUPLICATE_ACTIVE") {
    await db().query("INSERT INTO audit_events (type, user_id, data) VALUES ('DUPLICATE_DETECTED', $1, $2)", [userId, { mediaId }]);
    return { status: "DUPLICATE_ACTIVE", mediaId };
  }
  await restoreMedia(mediaId, userId, "REUPLOAD");
  return { status: "RESTORED", mediaId };
}

export type CreateUpload = { filename: string; size: number; mime?: string | null; lastModified?: number | null; fingerprint?: string | null; sha256?: string | null };

/** Creates an upload, or resumes the user's incomplete one with the same fingerprint (§9.6). */
export async function createUpload(userId: string, u: CreateUpload) {
  if (!u.filename || u.filename.length > 1000) throw badRequest("Nome de arquivo inválido.");
  if (!Number.isSafeInteger(u.size) || u.size < 0) throw badRequest("Tamanho inválido.");
  if (u.size > config().MAX_UPLOAD_BYTES) throw new HttpError(413, "TOO_LARGE", "Arquivo grande demais.");
  if (u.fingerprint) {
    const r = await db().query(
      "SELECT id FROM uploads WHERE user_id = $1 AND fingerprint = $2 AND state = 'UPLOADING' ORDER BY created_at DESC LIMIT 1",
      [userId, u.fingerprint],
    );
    if (r.rowCount) {
      const id = r.rows[0].id as string;
      return { id, offset: await syncOffset(id), chunkSize: config().UPLOAD_CHUNK_BYTES, resumed: true };
    }
  }
  const r = await db().query(
    `INSERT INTO uploads (user_id, original_filename, mime_reported, client_last_modified, expected_size, fingerprint, client_sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [userId, u.filename, u.mime?.slice(0, 200) || null, u.lastModified ? new Date(u.lastModified) : null, u.size,
      u.fingerprint?.slice(0, 500) ?? null, u.sha256 && /^[a-f0-9]{64}$/.test(u.sha256) ? u.sha256 : null],
  );
  const id = r.rows[0].id as string;
  log.info("upload.created", { uploadId: id, userId, filename: u.filename, size: u.size, mime: u.mime ?? null });
  await fsp.mkdir(abs(`staging/${id}`), { recursive: true });
  await fsp.writeFile(stagingPath(id), "");
  if (u.size === 0) await markReceived(id);
  return { id, offset: 0, chunkSize: config().UPLOAD_CHUNK_BYTES, resumed: false };
}

/** The staging file size on disk is the authoritative offset. */
async function syncOffset(id: string): Promise<number> {
  const size = await fsp.stat(stagingPath(id)).then((s) => s.size).catch(() => 0);
  await db().query("UPDATE uploads SET received_size = $2, updated_at = now() WHERE id = $1", [id, size]);
  return size;
}

async function getOwned(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const r = await db().query("SELECT * FROM uploads WHERE id = $1 AND user_id = $2", [id, userId]);
  if (!r.rowCount) throw notFound("Upload não encontrado.");
  return r.rows[0];
}

export async function uploadStatus(userId: string, id: string) {
  const u = await getOwned(userId, id);
  const offset = u.state === "UPLOADING" ? await syncOffset(id) : Number(u.received_size);
  return { id, state: u.state as UploadState, offset, size: Number(u.expected_size), mediaId: u.media_id, reason: u.failure_reason };
}

export async function bulkStatus(userId: string, ids: string[]) {
  const valid = ids.filter((i) => /^[0-9a-f-]{36}$/.test(i)).slice(0, 500);
  if (!valid.length) return [];
  const r = await db().query(
    "SELECT id, state, received_size, expected_size, media_id, failure_reason FROM uploads WHERE user_id = $1 AND id = ANY($2::uuid[])",
    [userId, valid],
  );
  return r.rows.map((u) => ({ id: u.id, state: u.state, offset: Number(u.received_size), size: Number(u.expected_size), mediaId: u.media_id, reason: u.failure_reason }));
}

/**
 * Appends one chunk. Bounded memory: the request body is streamed to disk.
 * The client must send the exact current offset (tus semantics); mismatch -> 409 with the real offset.
 */
const g = globalThis as unknown as { __weddingAppending?: Set<string> };
export async function appendChunk(userId: string, id: string, offset: number, body: ReadableStream<Uint8Array> | null) {
  g.__weddingAppending ??= new Set();
  if (g.__weddingAppending.has(id)) throw new HttpError(423, "BUSY", "Este arquivo já está recebendo dados.");
  g.__weddingAppending.add(id);
  try { return await appendChunkLocked(userId, id, offset, body); } finally { g.__weddingAppending.delete(id); }
}

async function appendChunkLocked(userId: string, id: string, offset: number, body: ReadableStream<Uint8Array> | null) {
  const u = await getOwned(userId, id);
  if (u.state !== "UPLOADING") throw new HttpError(409, "NOT_UPLOADING", `Upload em estado ${u.state}.`);
  const current = await fsp.stat(stagingPath(id)).then((s) => s.size);
  if (offset !== current) throw Object.assign(new HttpError(409, "OFFSET_MISMATCH", String(current)), { offset: current });
  if (!body) throw badRequest("Corpo vazio.");
  const expected = Number(u.expected_size);
  const max = expected - current;
  let written = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      written += chunk.length;
      if (written > max) return cb(new HttpError(413, "TOO_MUCH_DATA", "Dados além do tamanho declarado."));
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as any), limiter, fs.createWriteStream(stagingPath(id), { flags: "a" }));
  } catch (e) {
    // partial chunk bytes are kept; the offset reported next time reflects them
    if (e instanceof HttpError) throw e;
  }
  const newOffset = await syncOffset(id);
  if (newOffset === expected) await markReceived(id);
  return { offset: newOffset, complete: newOffset === expected };
}

async function markReceived(id: string) {
  const r = await db().query("UPDATE uploads SET state = 'VERIFYING', updated_at = now() WHERE id = $1 AND state = 'UPLOADING' RETURNING user_id", [id]);
  if (r.rowCount) {
    await enqueue("FINALIZE_UPLOAD", { uploadId: id }, { dedupeKey: `finalize:${id}`, priority: 10 });
    await publish({ t: "upload", userId: r.rows[0].user_id, uploadId: id, state: "VERIFYING" });
  }
}

export async function cancelUpload(userId: string, id: string) {
  const u = await getOwned(userId, id);
  if ((TERMINAL as string[]).includes(u.state)) return { state: u.state };
  if (u.state !== "UPLOADING") throw new HttpError(409, "CANNOT_CANCEL", "O arquivo já está sendo finalizado.");
  await tx(async (c) => {
    await c.query("UPDATE uploads SET state = 'CANCELLED', updated_at = now() WHERE id = $1 AND state = 'UPLOADING'", [id]);
  });
  await fsp.rm(abs(`staging/${id}`), { recursive: true, force: true }).catch(() => {});
  return { state: "CANCELLED" };
}
