import { handle, badRequest } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { counts, listMedia } from "@/server/services/media";
export const dynamic = "force-dynamic";
export const GET = handle(async (req) => {
  await requireUser();
  const q = new URL(req.url).searchParams;
  const order = q.get("order") === "asc" ? "asc" : "desc";
  const uploader = q.get("uploader");
  if (uploader && !/^[0-9a-f-]{36}$/.test(uploader)) throw badRequest("uploader inválido");
  const limit = Math.min(Math.max(Number(q.get("limit") ?? 60), 1), 200);
  const page = await listMedia({ order, uploader, cursor: q.get("cursor"), limit });
  return Response.json(q.get("cursor") ? page : { ...page, counts: await counts() });
});
