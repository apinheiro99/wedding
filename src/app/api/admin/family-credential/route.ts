import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { requireAdmin, setFamilyCredential } from "@/server/services/auth";
const Body = z.object({ login: z.string().min(1).max(100), password: z.string().min(6).max(200) });
export const POST = handle(async (req) => {
  await requireAdmin();
  const b = await readJson(req, Body.parse);
  await setFamilyCredential(b.login, b.password);
  return Response.json({ ok: true });
});
