import { handle, badRequest } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { heroVersions, isSlot, removeHero, setHero, SLOTS } from "@/server/services/branding";
export const dynamic = "force-dynamic";
export const GET = handle(async () => { await requireAdmin(); return Response.json({ slots: SLOTS, versions: await heroVersions() }); });
export const POST = handle(async (req) => {
  await requireAdmin();
  const fd = await req.formData();
  const slot = fd.get("slot"), f = fd.get("file");
  if (!isSlot(slot)) throw badRequest("Espaço inválido.");
  if (!(f instanceof File) || f.size > 40 * 1024 * 1024) throw badRequest("Envie uma imagem de até 40 MB.");
  await setHero(slot, Buffer.from(await f.arrayBuffer()));
  return Response.json({ ok: true });
});
export const DELETE = handle(async (req) => {
  await requireAdmin();
  const slot = new URL(req.url).searchParams.get("slot");
  if (!isSlot(slot)) throw badRequest("Espaço inválido.");
  await removeHero(slot);
  return Response.json({ ok: true });
});
