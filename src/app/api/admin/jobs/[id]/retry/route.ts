import { handle } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { retryJob } from "@/server/services/jobs";
export const POST = handle<{ params: Promise<{ id: string }> }>(async (_r, { params }) => {
  await requireAdmin();
  await retryJob(Number((await params).id));
  return Response.json({ ok: true });
});
