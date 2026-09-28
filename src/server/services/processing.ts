import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { db } from "../db";
import { abs } from "../storage";
import { canonicalDate } from "../domain/rules";
import { thumbPath } from "./media";
import { publish } from "./events";
import { log } from "../log";

const run = promisify(execFile);
const SIZES = { sm: 480, lg: 2048 } as const;

type Meta = {
  exifDate?: Date | null; containerDate?: Date | null; offset?: string | null; latitude?: number | null; longitude?: number | null;
  make?: string | null; model?: string | null; orientation?: number | null; width?: number | null; height?: number | null;
  durationMs?: number | null; codec?: string | null; fps?: number | null;
};

async function imageMeta(file: string): Promise<Meta> {
  const exifr = (await import("exifr")).default;
  const m: Meta = {};
  try {
    const x = await exifr.parse(file, { tiff: true, exif: true, gps: true, reviveValues: true, translateValues: false });
    if (x) {
      m.exifDate = x.DateTimeOriginal ?? x.CreateDate ?? null;
      m.offset = x.OffsetTimeOriginal ?? x.OffsetTime ?? null;
      m.latitude = x.latitude ?? null; m.longitude = x.longitude ?? null;
      m.make = x.Make ?? null; m.model = x.Model ?? null; m.orientation = x.Orientation ?? null;
      m.width = x.ExifImageWidth ?? x.ImageWidth ?? null; m.height = x.ExifImageHeight ?? x.ImageHeight ?? null;
      // exifr gives local-time dates; honor the recorded offset when present
      if (m.exifDate && m.offset && /^[+-]\d{2}:\d{2}$/.test(m.offset)) {
        const d = m.exifDate;
        const iso = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${m.offset}`;
        const parsed = new Date(iso);
        if (!isNaN(parsed.getTime())) m.exifDate = parsed;
      }
    }
  } catch { /* no/invalid EXIF */ }
  return m;
}
const p2 = (n: number) => String(n).padStart(2, "0");

async function videoMeta(file: string): Promise<Meta> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
    const j = JSON.parse(stdout);
    const v = (j.streams ?? []).find((s: any) => s.codec_type === "video");
    const tags = { ...(j.format?.tags ?? {}), ...(v?.tags ?? {}) };
    const created = tags["com.apple.quicktime.creationdate"] ?? tags.creation_time;
    const loc: string | undefined = tags["com.apple.quicktime.location.ISO6709"] ?? tags.location;
    const gps = loc?.match(/([+-]\d+\.\d+)([+-]\d+\.\d+)/);
    const rot = Number(v?.side_data_list?.find((s: any) => s.rotation != null)?.rotation ?? v?.tags?.rotate ?? 0);
    const swap = Math.abs(rot) === 90 || Math.abs(rot) === 270;
    const [n, d] = String(v?.avg_frame_rate ?? "0/1").split("/").map(Number);
    return {
      containerDate: created ? new Date(created) : null,
      durationMs: j.format?.duration ? Math.round(Number(j.format.duration) * 1000) : null,
      width: v ? (swap ? v.height : v.width) : null, height: v ? (swap ? v.width : v.height) : null,
      codec: v?.codec_name ?? null, fps: d ? Math.round((n / d) * 100) / 100 : null,
      latitude: gps ? Number(gps[1]) : null, longitude: gps ? Number(gps[2]) : null,
      make: tags["com.apple.quicktime.make"] ?? null, model: tags["com.apple.quicktime.model"] ?? null,
    };
  } catch (e) {
    log.warn("ffprobe.failed", { error: (e as Error).message.slice(0, 200) });
    return {};
  }
}

/** Renders a decodable image into a temp PNG-free pipeline: sharp first, libheif/vips CLI fallback for HEIC. */
async function sourceForSharp(file: string, mime: string | null, tmpDir: string): Promise<string | Buffer> {
  const heic = /heic|heif/i.test(mime ?? "") || /\.(heic|heif)$/i.test(file);
  if (!heic) return file;
  // prebuilt sharp cannot decode HEVC; system libheif (with libde265) can
  const out = `${tmpDir}/decoded.jpg`;
  try { await run("heif-convert", ["-q", "92", file, out], { timeout: 120_000 }); return out; } catch { /* try vips */ }
  try { await run("vips", ["copy", file, out + "[Q=92]"], { timeout: 120_000 }); return out; } catch { /* last resort */ }
  return file;
}

async function videoFrame(file: string, tmpDir: string, durationMs: number | null): Promise<string> {
  const out = `${tmpDir}/frame.jpg`;
  const at = durationMs && durationMs > 2000 ? "1" : "0";
  await run("ffmpeg", ["-v", "error", "-y", "-ss", at, "-i", file, "-frames:v", "1", "-q:v", "3", out], { timeout: 120_000 });
  return out;
}

/** Metadata + thumbnails. Reads the original only; derivatives go to thumbnails/<id>/. */
export async function processMedia(mediaId: string) {
  const r = await db().query("SELECT * FROM media WHERE id = $1", [mediaId]);
  const m = r.rows[0];
  if (!m) return;
  const file = abs(m.relative_path);
  const started = Date.now();
  const meta: Meta = m.media_kind === "VIDEO" ? await videoMeta(file) : m.media_kind === "IMAGE" ? await imageMeta(file) : {};

  const tmpDir = abs(`temp/proc-${mediaId}`);
  await fsp.mkdir(tmpDir, { recursive: true });
  let thumbState = m.media_kind === "OTHER" ? "UNSUPPORTED" : "FAILED";
  let width = meta.width ?? null, height = meta.height ?? null;
  try {
    if (m.media_kind !== "OTHER") {
      const src = m.media_kind === "VIDEO" ? await videoFrame(file, tmpDir, meta.durationMs ?? null) : await sourceForSharp(file, m.mime_detected ?? m.mime_reported, tmpDir);
      await fsp.mkdir(abs(`thumbnails/${mediaId}`), { recursive: true });
      const img = sharp(src, { failOn: "none", limitInputPixels: false }).rotate(); // rotate derivative per EXIF; original untouched
      const info = await img.metadata();
      if (m.media_kind === "IMAGE" && info.width && info.height) {
        const swap = (info.orientation ?? 1) >= 5;
        width = swap ? info.height : info.width; height = swap ? info.width : info.height;
      }
      for (const [k, px] of Object.entries(SIZES)) {
        const dest = thumbPath(mediaId, k as "sm" | "lg");
        await img.clone().resize({ width: px, height: px, fit: "inside", withoutEnlargement: true })
          .webp({ quality: k === "sm" ? 72 : 82 }).toFile(dest + ".tmp");
        await fsp.rename(dest + ".tmp", dest);
      }
      thumbState = "READY";
    }
  } catch (e) {
    log.warn("thumbnail.failed", { mediaId, error: (e as Error).message.slice(0, 300) });
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {}); // NFS may briefly keep .nfs* files
  }

  const date = canonicalDate({ exif: meta.exifDate, container: meta.containerDate, clientFile: m.client_last_modified, upload: m.created_at });
  const json = { ...meta, exifDate: meta.exifDate?.toISOString?.() ?? null, containerDate: meta.containerDate?.toISOString?.() ?? null };
  await db().query(
    `UPDATE media SET metadata_json = $2, capture_at = $3, capture_at_source = $4, sort_at = $5, width = $6, height = $7,
       duration_ms = $8, thumbnail_state = $9, updated_at = now() WHERE id = $1`,
    [mediaId, json, date.source === "UPLOAD" ? null : date.at, date.source, date.at, width, height, meta.durationMs ?? null, thumbState],
  );
  await publish({ t: "media", mediaId, userId: m.uploader_user_id, change: "ready" });
  log.info("media.processed", { mediaId, kind: m.media_kind, thumb: thumbState, ms: Date.now() - started });
}
