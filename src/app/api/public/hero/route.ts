import fsp from "node:fs/promises";
import { handle, notFound } from "@/server/http";
import { heroPath, isSlot } from "@/server/services/branding";
export const dynamic = "force-dynamic";
/** Public on purpose: landing/login backgrounds chosen by the admin. */
export const GET = handle(async (req) => {
  const q = new URL(req.url).searchParams;
  const slot = q.get("slot") ?? "landing-mobile";
  if (!isSlot(slot)) throw notFound();
  const w = q.get("w") === "900" ? 900 : 1920;
  const buf = await fsp.readFile(heroPath(slot, w)).catch(() => null);
  if (!buf) throw notFound();
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", "cache-control": "public, max-age=86400" } });
});
