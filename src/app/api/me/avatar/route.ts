import { handle, badRequest } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { removeAvatar, setAvatar } from "@/server/services/avatars";
export const POST = handle(async (req) => {
  const u = await requireUser();
  const f = (await req.formData()).get("file");
  if (!(f instanceof File)) throw badRequest("Envie uma imagem.");
  await setAvatar(u.id, f);
  return Response.json({ ok: true });
});
export const DELETE = handle(async () => { const u = await requireUser(); await removeAvatar(u.id); return Response.json({ ok: true }); });
