import { handle, badRequest } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { removeHero, setHero } from "@/server/services/branding";
export const POST = handle(async (req) => {
  await requireAdmin();
  const f = (await req.formData()).get("file");
  if (!(f instanceof File) || f.size > 40 * 1024 * 1024) throw badRequest("Envie uma imagem de até 40 MB.");
  await setHero(Buffer.from(await f.arrayBuffer()));
  return Response.json({ ok: true });
});
export const DELETE = handle(async () => { await requireAdmin(); await removeHero(); return Response.json({ ok: true }); });
