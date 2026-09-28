import { handle } from "@/server/http";
import { requireAdmin } from "@/server/services/auth";
import { listUsers } from "@/server/services/admin";
export const dynamic = "force-dynamic";
export const GET = handle(async () => { await requireAdmin(); return Response.json({ users: await listUsers() }); });
