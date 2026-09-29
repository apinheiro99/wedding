import fs from "node:fs";
import { Readable } from "node:stream";
import { notFound } from "./http";

/** Só tipos passivos de mídia podem ser exibidos inline; qualquer outra coisa (html, svg, xml, js...) vira download. */
const INLINE_SAFE = /^(image\/(jpeg|png|gif|webp|avif|heic|heif|bmp|tiff)|video\/[a-z0-9.+-]+|audio\/[a-z0-9.+-]+)$/i;

/** Streams a file with Range support. Never buffers whole files; never cached by shared caches. */
export async function serveFile(req: Request, path: string, o: { filename: string; size: number; mime: string; inline: boolean }) {
  const st = await fs.promises.stat(path).catch(() => null);
  if (!st) throw notFound("Arquivo indisponível.");
  const size = st.size;
  const inline = o.inline && INLINE_SAFE.test(o.mime);
  const ascii = o.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const headers: Record<string, string> = {
    "content-type": inline ? o.mime : "application/octet-stream",
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(o.filename)}`,
    "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'",
  };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const s = fs.createReadStream(path, { start, end, highWaterMark: 1024 * 1024 });
    req.signal.addEventListener("abort", () => s.destroy());
    return new Response(Readable.toWeb(s) as ReadableStream, { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
  }
  const s = fs.createReadStream(path, { highWaterMark: 1024 * 1024 });
  req.signal.addEventListener("abort", () => s.destroy());
  return new Response(Readable.toWeb(s) as ReadableStream, { headers: { ...headers, "content-length": String(size) } });
}
