import { handle } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { listPackages } from "@/server/services/packages";
export const dynamic = "force-dynamic";
export const GET = handle(async () => { await requireUser(); return Response.json({ uploaders: await listPackages() }); });
