import { handle } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { mediaFile } from "@/server/services/media";
import { serveFile } from "@/server/files";
import { db } from "@/server/db";
type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const GET = handle<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = (await params).id;
  const f = await mediaFile(id, { isAdmin: u.sessionKind === "ADMIN" });
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  if (!inline && !req.headers.get("range")) await db().query("INSERT INTO download_events (user_id, media_id, bytes) VALUES ($1, $2, $3)", [u.id, id, f.size]);
  return serveFile(req, f.path, { filename: f.filename, size: f.size, mime: f.mime, inline });
});
