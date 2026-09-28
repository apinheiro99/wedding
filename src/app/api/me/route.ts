import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { renameUser, requireUser } from "@/server/services/auth";
export const dynamic = "force-dynamic";
export const GET = handle(async () => {
  const u = await requireUser();
  return Response.json({ id: u.id, email: u.email, displayName: u.displayName, isAdmin: u.role === "ADMIN" });
});
const Body = z.object({ displayName: z.string().max(100) });
export const PATCH = handle(async (req) => {
  const u = await requireUser();
  const b = await readJson(req, Body.parse);
  await renameUser(u.id, b.displayName);
  return Response.json({ ok: true });
});
