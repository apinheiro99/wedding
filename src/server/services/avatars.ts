import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { db } from "../db";
import { abs } from "../storage";
import { badRequest } from "../http";

const run = promisify(execFile);
export const avatarPath = (userId: string) => abs(`avatars/${userId}.webp`);
const MAX = 25 * 1024 * 1024;

/** Stores a 320px square WebP derived from the uploaded image (HEIC via libheif). */
export async function setAvatar(userId: string, file: File) {
  if (file.size > MAX) throw badRequest("Imagem muito grande (máx. 25 MB).");
  await fsp.mkdir(abs("avatars"), { recursive: true });
  const tmp = abs(`temp/avatar-${userId}-${Date.now()}`);
  await fsp.writeFile(tmp, new Uint8Array(await file.arrayBuffer()));
  let src = tmp;
  try {
    try { await sharp(src).stats(); } catch {
      await run("heif-convert", [tmp, tmp + ".jpg"], { timeout: 60_000 });
      src = tmp + ".jpg";
    }
    await sharp(src).rotate().resize(320, 320, { fit: "cover", position: "attention" }).webp({ quality: 82 }).toFile(avatarPath(userId) + ".tmp");
    await fsp.rename(avatarPath(userId) + ".tmp", avatarPath(userId));
  } catch {
    throw badRequest("Não conseguimos ler esta imagem. Tente JPG, PNG ou HEIC.");
  } finally {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    await fsp.rm(tmp + ".jpg", { force: true }).catch(() => {});
  }
  await db().query("UPDATE users SET avatar_version = coalesce(avatar_version, 0) + 1, updated_at = now() WHERE id = $1", [userId]);
}

export async function removeAvatar(userId: string) {
  await db().query("UPDATE users SET avatar_version = NULL, updated_at = now() WHERE id = $1", [userId]);
  await fsp.rm(avatarPath(userId), { force: true }).catch(() => {});
}

export async function avatarVersions(): Promise<Record<string, number>> {
  const r = await db().query("SELECT id, avatar_version FROM users WHERE avatar_version IS NOT NULL");
  return Object.fromEntries(r.rows.map((x) => [x.id, x.avatar_version]));
}
