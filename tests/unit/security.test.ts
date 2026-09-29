import { describe, it, expect } from "vitest";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { loadConfig } from "@/server/config";
import { serveFile } from "@/server/files";
import { log } from "@/server/log";

const base = {
  PG_HOST: "localhost", PG_USER: "postgres", PG_PASSWORD: "x", PG_APP_DB: "wedding_unit_test", STORAGE_ROOT: "/tmp/x",
  FAMILY_BOOTSTRAP_LOGIN: "familia", ADMIN_EMAIL: "admin@test.local",
};
// generated at runtime so no secret-looking literals live in the repo (and secret scanners stay quiet)
const rnd = () => randomBytes(24).toString("hex");
const good = { SESSION_SECRET: rnd(), FAMILY_BOOTSTRAP_PASSWORD: rnd().slice(0, 16), ADMIN_BOOTSTRAP_PASSWORD: rnd().slice(0, 16) };

describe("production config guards", () => {
  it("rejects the .env.example placeholder secret in production", () => {
    expect(() => loadConfig({ ...base, ...good, SESSION_SECRET: "change-me-at-least-32-chars-long-random", NODE_ENV: "production" } as any)).toThrow(/placeholder/);
  });
  it("accepts strong values in production", () => {
    expect(() => loadConfig({ ...base, ...good, NODE_ENV: "production" } as any)).not.toThrow();
  });
  it("does not block placeholders outside production", () => {
    expect(() => loadConfig({ ...base, ...good, SESSION_SECRET: "change-me-at-least-32-chars-long-random", NODE_ENV: "development" } as any)).not.toThrow();
  });
});

describe("serveFile hardening (stored XSS)", () => {
  const serve = async (mime: string, inline: boolean) => {
    const f = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "srv-")), "a.bin");
    await fs.writeFile(f, "<script>alert(1)</script>");
    return serveFile(new Request("http://x/"), f, { filename: "a.html", size: 25, mime, inline });
  };
  it.each(["text/html", "image/svg+xml", "application/xhtml+xml", "text/javascript"])("never renders %s inline", async (mime) => {
    const r = await serve(mime, true);
    expect(r.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    await r.body?.cancel();
  });
  it("still allows inline images and videos", async () => {
    for (const mime of ["image/jpeg", "video/mp4"]) {
      const r = await serve(mime, true);
      expect(r.headers.get("content-disposition")).toMatch(/^inline/);
      expect(r.headers.get("content-type")).toBe(mime);
      await r.body?.cancel();
    }
  });
});

describe("logger redaction", () => {
  it("masks secrets in emitted lines", () => {
    const lines: string[] = [];
    const orig = console.error;
    process.env.LOG_LEVEL = "error"; process.env.LOG_FORMAT = "json"; process.env.LOG_DIR = "";
    console.error = (l: string) => lines.push(l);
    try { log.error("t", { password: "hunter2", otp: "123456", nested: { api_key: "k", ok: 1 } }); } finally { console.error = orig; }
    const out = lines.join("");
    expect(out).not.toMatch(/hunter2|123456/);
    expect(out).toContain('"ok":1');
  });
});
