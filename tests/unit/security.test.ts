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

describe("access context in logs", () => {
  it("adds ip, user agent, user and role to every line logged inside a request", async () => {
    const { runWithContext, setContextUser } = await import("@/server/context");
    const lines: string[] = [];
    const orig = console.log;
    process.env.LOG_LEVEL = "info"; process.env.LOG_FORMAT = "json"; process.env.LOG_DIR = "";
    console.log = (l: string) => lines.push(l);
    try {
      await runWithContext({ rid: "r1", ip: "203.0.113.9", ua: "Mozilla/5.0 test" }, async () => {
        log.info("before-login");
        setContextUser({ id: "u1", displayName: "Maria", role: "USER" });
        log.info("after-login");
      });
    } finally { console.log = orig; }
    const [a, b] = lines.map((l) => JSON.parse(l));
    expect(a).toMatchObject({ rid: "r1", ip: "203.0.113.9", ua: "Mozilla/5.0 test" });
    expect(a.uid).toBeUndefined();
    expect(b).toMatchObject({ uid: "u1", user: "Maria", role: "USER", ip: "203.0.113.9" });
  });
});

describe("ADMIN_TUNNEL_SECRET config guard", () => {
  it("rejects a secret shorter than 16 chars", () => {
    expect(() => loadConfig({ ...base, ...good, ADMIN_TUNNEL_SECRET: "short" } as any)).toThrow();
  });
  it("accepts a strong secret, and omitting it entirely", () => {
    expect(() => loadConfig({ ...base, ...good, ADMIN_TUNNEL_SECRET: "a".repeat(16) } as any)).not.toThrow();
    expect(() => loadConfig({ ...base, ...good } as any)).not.toThrow();
  });
});

describe("middleware: admin panel gate", () => {
  const withEnv = async (vars: Record<string, string | undefined>, fn: () => Promise<void>) => {
    const prev: Record<string, string | undefined> = {};
    for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
    try { await fn(); } finally { for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
  };
  const req = (path: string, headers: Record<string, string> = {}) => {
    const { NextRequest } = require("next/server");
    return new NextRequest(`http://localhost${path}`, { headers });
  };

  it("legacy mode (no secret): blocks anything that carries a Cloudflare header, allows the rest", async () => {
    await withEnv({ ADMIN_TUNNEL_SECRET: undefined }, async () => {
      const { middleware } = await import("@/middleware");
      const viaCf = middleware(req("/admin/login", { "cf-ray": "x" }));
      expect(viaCf.status).toBe(404);
      const direct = middleware(req("/admin/login"));
      expect(direct.status).not.toBe(404);
    });
  });

  it("strong mode (secret set): requires a matching x-tunnel-auth, closing the fail-open even with spoofed cf-* headers", async () => {
    await withEnv({ ADMIN_TUNNEL_SECRET: "s".repeat(20) }, async () => {
      const { middleware } = await import("@/middleware");
      expect(middleware(req("/admin/login")).status).toBe(404); // no header at all
      expect(middleware(req("/admin/login", { "cf-ray": "x" })).status).toBe(404); // spoofed cf-* alone isn't enough
      expect(middleware(req("/admin/login", { "x-tunnel-auth": "wrong-secret-wrong-secret" })).status).toBe(404);
      expect(middleware(req("/admin/login", { "x-tunnel-auth": "s".repeat(20) })).status).not.toBe(404);
      expect(middleware(req("/api/admin/metrics", { "x-tunnel-auth": "nope" })).status).toBe(404);
    });
  });
});
