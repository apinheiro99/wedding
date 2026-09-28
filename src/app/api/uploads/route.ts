import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { createUpload } from "@/server/services/uploads";
const Body = z.object({
  filename: z.string().min(1).max(1000), size: z.number().int().nonnegative(), mime: z.string().max(200).nullish(),
  lastModified: z.number().nullish(), fingerprint: z.string().max(500).nullish(), sha256: z.string().length(64).nullish(),
});
export const POST = handle(async (req) => {
  const u = await requireUser();
  return Response.json(await createUpload(u.id, await readJson(req, Body.parse)), { status: 201 });
});
