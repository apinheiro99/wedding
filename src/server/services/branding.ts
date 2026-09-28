import fsp from "node:fs/promises";
import sharp from "sharp";
import { abs } from "../storage";
import { badRequest } from "../http";
import { setSetting, getSetting } from "./settings";

/** Background slots. Each keeps derived WebP copies in storage (never in git). */
export const SLOTS = {
  "landing-desktop": "Página inicial (computador) — texto fica à esquerda",
  "landing-mobile": "Página inicial (celular) — casal no centro",
  auth: "Login e primeiro acesso — formulário fica à direita",
} as const;
export type Slot = keyof typeof SLOTS;
export const isSlot = (s: unknown): s is Slot => typeof s === "string" && s in SLOTS;

export const heroPath = (slot: Slot, w: 900 | 1920) => abs(`branding/${slot}-${w}.webp`);

export async function heroVersions(): Promise<Record<Slot, number>> {
  const v = (await getSetting("hero_versions")) ?? {};
  return { "landing-desktop": v["landing-desktop"] ?? 0, "landing-mobile": v["landing-mobile"] ?? 0, auth: v.auth ?? 0 };
}

export async function setHero(slot: Slot, input: Buffer) {
  await fsp.mkdir(abs("branding"), { recursive: true });
  try {
    for (const w of [900, 1920] as const) {
      await sharp(input).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: w === 900 ? 74 : 80 }).toFile(heroPath(slot, w) + ".tmp");
      await fsp.rename(heroPath(slot, w) + ".tmp", heroPath(slot, w));
    }
  } catch { throw badRequest("Não conseguimos ler esta imagem."); }
  const v = await heroVersions();
  await setSetting("hero_versions", { ...v, [slot]: v[slot] + 1 });
}

export async function removeHero(slot: Slot) {
  const v = await heroVersions();
  await setSetting("hero_versions", { ...v, [slot]: 0 });
  for (const w of [900, 1920] as const) await fsp.rm(heroPath(slot, w), { force: true }).catch(() => {});
}
