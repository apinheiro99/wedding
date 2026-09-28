import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { checkHash } from "@/server/services/uploads";
const Body = z.object({ sha256: z.string().length(64) });
export const POST = handle(async (req) => {
  const u = await requireUser();
  const b = await readJson(req, Body.parse);
  return Response.json(await checkHash(u.id, b.sha256.toLowerCase()));
});
