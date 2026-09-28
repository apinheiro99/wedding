import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { bulkStatus } from "@/server/services/uploads";
const Body = z.object({ ids: z.array(z.string()).max(500) });
export const POST = handle(async (req) => {
  const u = await requireUser();
  return Response.json({ uploads: await bulkStatus(u.id, (await readJson(req, Body.parse)).ids) });
});
