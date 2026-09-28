// Dev smoke test: uploads files through the public API with a session cookie. Usage: node scripts/smoke-upload.mjs <cookie> <files...>
import fs from "node:fs";
import path from "node:path";
const [cookie, ...files] = process.argv.slice(2);
const base = process.env.BASE ?? "http://localhost:3000";
const H = { cookie, "x-requested-with": "fetch" };
for (const f of files) {
  const buf = fs.readFileSync(f);
  const c = await (await fetch(base + "/api/uploads", { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ filename: path.basename(f), size: buf.length, lastModified: fs.statSync(f).mtimeMs, fingerprint: path.basename(f) + buf.length }) })).json();
  let off = c.offset; const cs = 4096;
  while (off < buf.length) {
    const r = await fetch(`${base}/api/uploads/${c.id}`, { method: "PATCH", headers: { ...H, "upload-offset": String(off), "content-type": "application/offset+octet-stream" }, body: buf.subarray(off, off + cs) });
    off = (await r.json()).offset;
  }
  let s;
  for (let i = 0; i < 40; i++) { s = await (await fetch(`${base}/api/uploads/${c.id}`, { headers: H })).json(); if (!["UPLOADING","VERIFYING","FINALIZING"].includes(s.state)) break; await new Promise(r => setTimeout(r, 500)); }
  console.log(path.basename(f), s.state, s.mediaId ?? "", s.reason ?? "");
}
