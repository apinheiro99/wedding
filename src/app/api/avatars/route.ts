import { handle } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { avatarVersions } from "@/server/services/avatars";
export const dynamic = "force-dynamic";
export const GET = handle(async () => { await requireUser(); return Response.json({ versions: await avatarVersions() }); });
