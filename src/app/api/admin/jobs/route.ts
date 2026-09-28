import { handle } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { listJobs } from "@/server/services/admin";
export const dynamic = "force-dynamic";
export const GET = handle(async (req) => { await requireAdmin(); return Response.json(await listJobs(new URL(req.url).searchParams.get("state"))); });
