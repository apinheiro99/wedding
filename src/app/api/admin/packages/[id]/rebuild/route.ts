import { handle } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { rebuildPackage } from "@/server/services/admin";
export const POST = handle<{ params: Promise<{ id: string }> }>(async (_r, { params }) => {
  await requireAdmin();
  await rebuildPackage((await params).id);
  return Response.json({ ok: true });
});
