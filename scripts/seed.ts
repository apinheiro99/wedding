// Dev-only seed (§31): fake family members (two named Maria) who upload real files through the HTTP API.
// Usage: npm run seed -- "<folder with photos>" [maxFiles]
import fs from "node:fs";
import path from "node:path";
import { config } from "../src/server/config";
import { db } from "../src/server/db";
import { ensureBooted } from "../src/server/bootstrap";
import { createSession } from "../src/server/services/auth";

if (config().NODE_ENV === "production") throw new Error("seed refused in production");
const base = process.env.BASE ?? "http://localhost:3000";
const PEOPLE = [
  ["Maria", "maria1@example.com"], ["Maria", "maria2@example.com"], ["João", "joao@example.com"], ["Juliana", "juliana@example.com"],
];

async function upload(cookie: string, file: string) {
  const st = fs.statSync(file);
  const H = { cookie, "x-requested-with": "fetch" };
  const c = await (await fetch(base + "/api/uploads", { method: "POST", headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify({ filename: path.basename(file), size: st.size, lastModified: st.mtimeMs, fingerprint: `seed|${file}|${st.size}` }) })).json();
  let off = c.offset as number;
  const fd = fs.openSync(file, "r");
  while (off < st.size) {
    const len = Math.min(c.chunkSize, st.size - off);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, off);
    const r = await fetch(`${base}/api/uploads/${c.id}`, { method: "PATCH", headers: { ...H, "upload-offset": String(off) }, body: buf });
    off = (await r.json()).offset;
  }
  fs.closeSync(fd);
}

async function main() {
  const dir = process.argv[2];
  const max = Number(process.argv[3] ?? 10_000);
  await ensureBooted();
  const cookies: string[] = [];
  for (const [name, email] of PEOPLE) {
    const r = await db().query(
      `WITH nid AS (SELECT gen_random_uuid() AS id)
       INSERT INTO users (id, email, display_name, email_verified_at, folder_name)
       SELECT id, $1, $2, now(), $3 || '__' || left(id::text, 8) FROM nid
       ON CONFLICT ((lower(email))) DO UPDATE SET updated_at = now() RETURNING id`,
      [email, name, name.normalize("NFD").replace(/[̀-ͯ]/g, "")]);
    const s = await createSession(r.rows[0].id, "USER", "seed");
    cookies.push(`wp_sid=${s.token}`);
  }
  if (dir) {
    const files = fs.readdirSync(dir).filter((f) => !f.startsWith(".")).sort().slice(0, max).map((f) => path.join(dir, f));
    let i = 0;
    // 4 parallel lanes, round-robin between people
    await Promise.all([0, 1, 2, 3].map(async () => {
      while (i < files.length) {
        const k = i++;
        await upload(cookies[k % cookies.length]!, files[k]!).catch((e) => console.error("fail", files[k], e.message));
        if (k % 25 === 0) console.log(`${k}/${files.length}`);
      }
    }));
    console.log(`uploaded ${files.length}`);
  }
  await db().end();
}
main();
