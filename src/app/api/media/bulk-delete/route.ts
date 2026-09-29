import { z } from "zod";
import { handle, readJson, badRequest } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { bulkSoftDelete } from "@/server/services/media";
const Body = z.object({ ids: z.array(z.string()).min(1).max(1000) });
export const dynamic = "force-dynamic";
/** Deletes several media at once (e.g. a shift-click range). Items the caller can't delete are skipped, not an error. */
export const POST = handle(async (req) => {
  const u = await requireUser();
  const b = await readJson(req, Body.parse);
  if (!b.ids.every((id) => /^[0-9a-f-]{36}$/.test(id))) throw badRequest("IDs inválidos.");
  return Response.json(await bulkSoftDelete(b.ids, { id: u.id, isAdmin: u.sessionKind === "ADMIN" }));
});
