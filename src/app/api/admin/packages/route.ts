import { handle } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { listPackagesAdmin } from "@/server/services/admin";
export const dynamic = "force-dynamic";
export const GET = handle(async () => { await requireAdmin(); return Response.json({ packages: await listPackagesAdmin() }); });
