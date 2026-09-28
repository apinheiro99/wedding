import fsp from "node:fs/promises";
import { handle, notFound } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { thumbPath } from "@/server/services/media";
import { db } from "@/server/db";
type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const GET = handle<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const r = await db().query("SELECT deleted_at FROM media WHERE id = $1", [id]);
  if (!r.rowCount || (r.rows[0].deleted_at && u.sessionKind !== "ADMIN")) throw notFound();
  const size = new URL(req.url).searchParams.get("s") === "lg" ? "lg" : "sm";
  const buf = await fsp.readFile(thumbPath(id, size)).catch(() => null);
  if (!buf) throw notFound();
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=86400" } });
});
