import fsp from "node:fs/promises";
import { handle, notFound } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { avatarPath } from "@/server/services/avatars";
export const dynamic = "force-dynamic";
export const GET = handle<{ params: Promise<{ id: string }> }>(async (_r, { params }) => {
  await requireUser();
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const buf = await fsp.readFile(avatarPath(id)).catch(() => null);
  if (!buf) throw notFound();
  return new Response(new Uint8Array(buf), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=31536000, immutable" } });
});
