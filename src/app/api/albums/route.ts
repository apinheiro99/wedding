import { handle } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { listAlbums } from "@/server/services/media";
export const dynamic = "force-dynamic";
export const GET = handle(async () => { await requireUser(); return Response.json({ albums: await listAlbums() }); });
