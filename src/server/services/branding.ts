import fsp from "node:fs/promises";
import sharp from "sharp";
import { abs } from "../storage";
import { badRequest } from "../http";
import { setSetting, getSetting } from "./settings";

export const heroPath = (w: 900 | 1920) => abs(`branding/hero-${w}.webp`);

/** Landing background: derived WebP copies only (kept in storage, never in git). */
export async function setHero(input: Buffer) {
  await fsp.mkdir(abs("branding"), { recursive: true });
  try {
    for (const w of [900, 1920] as const) {
      await sharp(input).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: w === 900 ? 72 : 80 }).toFile(heroPath(w) + ".tmp");
      await fsp.rename(heroPath(w) + ".tmp", heroPath(w));
    }
  } catch { throw badRequest("Não conseguimos ler esta imagem."); }
  await setSetting("hero_version", ((await getSetting("hero_version")) ?? 0) + 1);
}

export async function removeHero() {
  await setSetting("hero_version", 0);
  for (const w of [900, 1920] as const) await fsp.rm(heroPath(w), { force: true }).catch(() => {});
}
