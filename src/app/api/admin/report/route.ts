import { handle } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { runDailyReport } from "@/server/services/notifications";
export const POST = handle(async () => { await requireAdmin(); await runDailyReport(true); return Response.json({ ok: true }); });
