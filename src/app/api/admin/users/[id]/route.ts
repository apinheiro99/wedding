import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { updateUser } from "@/server/services/admin";
const Body = z.object({ displayName: z.string().max(100).optional(), status: z.enum(["ACTIVE", "DISABLED"]).optional() });
export const PATCH = handle<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  await requireAdmin();
  await updateUser((await params).id, await readJson(req, Body.parse));
  return Response.json({ ok: true });
});
