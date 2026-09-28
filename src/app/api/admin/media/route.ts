import { handle } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { listMedia } from "@/server/services/media";
export const dynamic = "force-dynamic";
export const GET = handle(async (req) => {
  await requireAdmin();
  const q = new URL(req.url).searchParams;
  const f = q.get("filter");
  return Response.json(await listMedia({ order: "desc", cursor: q.get("cursor"), limit: 60, includeDeleted: f === "all", onlyDeleted: f === "deleted" }));
});
