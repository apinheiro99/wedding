import { log } from "@/server/log";
import { handle, HttpError, notFound } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { resolveDownload } from "@/server/services/packages";
import { serveFile } from "@/server/files";
import { db } from "@/server/db";
type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const GET = handle<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const id = (await params).id;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const v = await resolveDownload(id);
  if (!v) throw new HttpError(409, "PREPARING", "Este pacote está sendo preparado.");
  if (!req.headers.get("range")) log.info("download.package", { packageId: (await params).id });
  if (!req.headers.get("range")) await db().query("INSERT INTO download_events (user_id, package_version_id, bytes) VALUES ($1, $2, $3)", [u.id, v.versionId, v.size]);
  return serveFile(req, v.path, { filename: v.filename, size: v.size, mime: "application/zip", inline: false });
});
