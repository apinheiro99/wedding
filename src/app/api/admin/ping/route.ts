import { handle } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
export const dynamic = "force-dynamic";
export const GET = handle(async () => { const a = await requireAdmin(); return Response.json({ ok: true, email: a.email }); });
