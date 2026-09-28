import { handle } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { restoreMedia } from "@/server/services/media";
export const POST = handle<{ params: Promise<{ id: string }> }>(async (_r, { params }) => {
  const a = await requireAdmin();
  await restoreMedia((await params).id, a.id, "ADMIN");
  return Response.json({ ok: true });
});
