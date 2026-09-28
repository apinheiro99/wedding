import { handle } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { mediaDetail, softDelete } from "@/server/services/media";
type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const GET = handle<Ctx>(async (_r, { params }) => {
  const u = await requireUser();
  return Response.json(await mediaDetail((await params).id, { id: u.id, isAdmin: u.sessionKind === "ADMIN" }));
});
export const DELETE = handle<Ctx>(async (_r, { params }) => {
  const u = await requireUser();
  await softDelete((await params).id, { id: u.id, isAdmin: u.sessionKind === "ADMIN" });
  return Response.json({ ok: true });
});
