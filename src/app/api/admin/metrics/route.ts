import { handle } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { metrics } from "@/server/services/metrics";
export const dynamic = "force-dynamic";
export const GET = handle(async (req) => { await requireAdmin(); return Response.json(await metrics(new URL(req.url).searchParams.get("tz"))); });
