import fsp from "node:fs/promises";
import { handle, notFound } from "@/server/http";
import { heroPath } from "@/server/services/branding";
export const dynamic = "force-dynamic";
/** Public on purpose: it is the landing background, chosen by the admin. */
export const GET = handle(async (req) => {
  const w = new URL(req.url).searchParams.get("w") === "900" ? 900 : 1920;
  const buf = await fsp.readFile(heroPath(w)).catch(() => null);
  if (!buf) throw notFound();
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", "cache-control": "public, max-age=86400" } });
});
