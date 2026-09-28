import { Readable } from "node:stream";
import { handle, badRequest } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { streamZip } from "@/server/services/packages";
import { db } from "@/server/db";
import { abs } from "@/server/storage";
export const dynamic = "force-dynamic";
/** Ad hoc ZIP for a multi-selection, streamed (never buffered). Form POST so the browser downloads natively. */
export const POST = handle(async (req) => {
  const u = await requireUser();
  const form = await req.formData();
  const ids = String(form.get("ids") ?? "").split(",").filter((i) => /^[0-9a-f-]{36}$/.test(i)).slice(0, 5000);
  if (!ids.length) throw badRequest("Nenhum item selecionado.");
  const r = await db().query(
    `SELECT m.id, m.relative_path, m.stored_filename, us.display_name FROM media m JOIN users us ON us.id = m.uploader_user_id
     WHERE m.id = ANY($1::uuid[]) AND m.deleted_at IS NULL`, [ids]);
  const seen = new Set<string>();
  const entries = r.rows.map((m) => {
    let name = `${m.display_name.replace(/[\/\\]/g, "_")}/${m.stored_filename}`;
    for (let n = 2; seen.has(name.toLowerCase()); n++) name = `${m.display_name}/${n}_${m.stored_filename}`;
    seen.add(name.toLowerCase());
    return { path: abs(m.relative_path), name };
  });
  await db().query("INSERT INTO download_events (user_id, bytes) VALUES ($1, NULL)", [u.id]);
  return new Response(Readable.toWeb(streamZip(entries)) as ReadableStream, {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="selecao-${entries.length}-arquivos.zip"`, "cache-control": "private, no-store" },
  });
});
