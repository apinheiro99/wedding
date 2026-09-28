// Pure domain rules (unit tested). No I/O here.

export type DedupeDecision = "NEW" | "DUPLICATE_ACTIVE" | "DUPLICATE_SOFT_DELETED";
export function dedupeDecision(existing: { deletedAt: Date | null } | null | undefined): DedupeDecision {
  if (!existing) return "NEW";
  return existing.deletedAt ? "DUPLICATE_SOFT_DELETED" : "DUPLICATE_ACTIVE";
}

export type CaptureSource = "EXIF" | "CONTAINER" | "CLIENT_FILE" | "UPLOAD";
/** Spec §12.1 canonical sort date. */
export function canonicalDate(c: { exif?: Date | null; container?: Date | null; clientFile?: Date | null; upload: Date }): { at: Date; source: CaptureSource } {
  const ok = (d?: Date | null) => !!d && !isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getTime() < Date.now() + 86400_000;
  if (ok(c.exif)) return { at: c.exif!, source: "EXIF" };
  if (ok(c.container)) return { at: c.container!, source: "CONTAINER" };
  if (ok(c.clientFile)) return { at: c.clientFile!, source: "CLIENT_FILE" };
  return { at: c.upload, source: "UPLOAD" };
}

/** Spec §16.4: decide whether a new file goes into the last package or opens a new one. */
export function allocatePackage(last: { usedBytes: number; itemCount: number } | null, fileBytes: number, target: number): "LAST" | "NEW" {
  if (!last) return "NEW";
  if (last.itemCount === 0) return "LAST";
  return last.usedBytes + fileBytes <= target ? "LAST" : "NEW";
}

export type Activity = { userId: string; userName: string; kind: "IMAGE" | "VIDEO" | "OTHER"; bytes: number };
export type DigestLine = { userId: string; name: string; photos: number; videos: number; others: number; bytes: number };
/** Spec §19.2: each recipient only hears about other people's uploads. */
export function digestFor(recipientId: string, acts: Activity[]): DigestLine[] {
  const by = new Map<string, DigestLine>();
  for (const a of acts) {
    if (a.userId === recipientId) continue;
    const l = by.get(a.userId) ?? { userId: a.userId, name: a.userName, photos: 0, videos: 0, others: 0, bytes: 0 };
    if (a.kind === "IMAGE") l.photos++; else if (a.kind === "VIDEO") l.videos++; else l.others++;
    l.bytes += a.bytes;
    by.set(a.userId, l);
  }
  return [...by.values()].sort((a, b) => b.photos + b.videos + b.others - (a.photos + a.videos + a.others));
}

export type UploadState = "UPLOADING" | "VERIFYING" | "FINALIZING" | "COMPLETE" | "DUPLICATE" | "RESTORED" | "FAILED" | "CANCELLED";
const TRANSITIONS: Record<UploadState, UploadState[]> = {
  UPLOADING: ["VERIFYING", "FAILED", "CANCELLED"],
  VERIFYING: ["FINALIZING", "FAILED", "UPLOADING"],
  FINALIZING: ["COMPLETE", "DUPLICATE", "RESTORED", "FAILED"],
  COMPLETE: [], DUPLICATE: [], RESTORED: [], FAILED: [], CANCELLED: [],
};
export function canTransition(from: UploadState, to: UploadState) {
  return TRANSITIONS[from].includes(to);
}
export const TERMINAL: UploadState[] = ["COMPLETE", "DUPLICATE", "RESTORED", "FAILED", "CANCELLED"];

export function mediaKindFrom(mime: string | null | undefined, filename: string): "IMAGE" | "VIDEO" | "OTHER" {
  if (mime?.startsWith("image/")) return "IMAGE";
  if (mime?.startsWith("video/")) return "VIDEO";
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (["jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "tif", "tiff", "avif", "dng", "cr2", "cr3", "nef", "arw", "raf", "orf", "rw2", "bmp"].includes(ext)) return "IMAGE";
  if (["mov", "mp4", "m4v", "3gp", "avi", "mkv", "mts", "m2ts", "webm", "wmv", "mpg", "mpeg"].includes(ext)) return "VIDEO";
  return "OTHER";
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0).replace(".", ",")} ${u[i]}`;
}
