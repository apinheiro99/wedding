import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config";

export const DIRS = ["originals/users", "staging", "thumbnails", "previews", "packages", "temp"] as const;

export function root() {
  return config().STORAGE_ROOT;
}

/** Resolve a storage-relative path and refuse anything escaping the storage root. */
export function abs(relative: string): string {
  const r = root();
  const p = path.resolve(r, relative);
  if (p !== r && !p.startsWith(r + path.sep)) throw new Error("Path traversal blocked");
  return p;
}

export async function ensureStorage() {
  for (const d of DIRS) await fs.mkdir(abs(d), { recursive: true });
  const probe = abs("temp/.probe");
  await fs.writeFile(probe, "ok");
  await fs.rm(probe);
}

/** Filesystem-safe name that keeps the extension; the original is kept in DB. */
export function sanitizeFilename(name: string): string {
  let base = name.normalize("NFC").replace(/[\/\\\0<>:"|?*\x00-\x1f]/g, "_").replace(/^\.+/, "_").trim();
  if (!base) base = "arquivo";
  if (Buffer.byteLength(base) > 200) {
    const ext = path.extname(base).slice(0, 16);
    base = base.slice(0, 180 - ext.length) + ext;
  }
  return base;
}

/** IMG_1001.HEIC -> IMG_1001 (n).HEIC */
export function collisionName(name: string, n: number): string {
  if (n === 0) return name;
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  return `${stem} (${n})${ext}`;
}

/** Human-inspectable per-user folder: Maria-da-Silva__a1b2c3d4 */
export function userFolderName(displayName: string, userId: string): string {
  const slug = displayName
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "usuario";
  return `${slug}__${userId.slice(0, 8)}`;
}

const sizeCache = new Map<string, { at: number; v: Promise<number> }>();
/** Recursive size; cached 5 min because walking NFS is slow. */
export function dirSize(relative: string): Promise<number> {
  const c = sizeCache.get(relative);
  if (c && Date.now() - c.at < 300_000) return c.v;
  const v = dirSizeUncached(relative);
  sizeCache.set(relative, { at: Date.now(), v });
  return v;
}

async function dirSizeUncached(relative: string): Promise<number> {
  let total = 0;
  async function walk(p: string) {
    let entries;
    try { entries = await fs.readdir(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) await walk(f);
      else if (e.isFile()) total += (await fs.stat(f)).size;
    }
  }
  await walk(abs(relative));
  return total;
}

export async function diskFree(): Promise<{ free: number; total: number } | null> {
  try {
    const s = await fs.statfs(root());
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch { return null; }
}
