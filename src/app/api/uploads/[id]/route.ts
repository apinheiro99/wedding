import { handle, HttpError, badRequest } from "@/server/http";
import { requireUser } from "@/server/services/auth";
import { appendChunk, cancelUpload, uploadStatus } from "@/server/services/uploads";
type Ctx = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";

export const GET = handle<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  return Response.json(await uploadStatus(u.id, (await params).id));
});

/** tus-style PATCH: Upload-Offset header + raw chunk body, streamed to disk. */
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const u = await requireUser();
  const offset = Number(req.headers.get("upload-offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) throw badRequest("Upload-Offset inválido.");
  try {
    const r = await appendChunk(u.id, (await params).id, offset, req.body);
    return Response.json(r, { headers: { "upload-offset": String(r.offset) } });
  } catch (e) {
    if (e instanceof HttpError && e.code === "OFFSET_MISMATCH") {
      return Response.json({ error: e.code, offset: Number(e.message) }, { status: 409, headers: { "upload-offset": e.message } });
    }
    throw e;
  }
});

export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const u = await requireUser();
  return Response.json(await cancelUpload(u.id, (await params).id));
});
