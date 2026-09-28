import { describe, it, expect, beforeAll } from "vitest";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { setConfigForTests, loadConfig } from "@/server/config";

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "wedding-storage-unit-"));
  setConfigForTests(
    loadConfig({
      PG_HOST: "localhost",
      PG_USER: "postgres",
      PG_PASSWORD: "x",
      PG_APP_DB: "wedding_unit_test",
      STORAGE_ROOT: root,
      SESSION_SECRET: "x".repeat(40),
      FAMILY_BOOTSTRAP_LOGIN: "familia",
      FAMILY_BOOTSTRAP_PASSWORD: "segredo123",
      ADMIN_EMAIL: "admin@test.local",
      ADMIN_BOOTSTRAP_PASSWORD: "admin-pass-123",
      EMAIL_PROVIDER: "memory",
      NODE_ENV: "test",
    } as any),
  );
});

describe("collisionName", () => {
  it("returns original name for n=0", async () => {
    const { collisionName } = await import("@/server/storage");
    expect(collisionName("IMG_1001.HEIC", 0)).toBe("IMG_1001.HEIC");
  });
  it("inserts (n) before extension", async () => {
    const { collisionName } = await import("@/server/storage");
    expect(collisionName("IMG_1001.HEIC", 1)).toBe("IMG_1001 (1).HEIC");
    expect(collisionName("IMG_1001.HEIC", 2)).toBe("IMG_1001 (2).HEIC");
  });
  it("handles names without extension", async () => {
    const { collisionName } = await import("@/server/storage");
    expect(collisionName("noext", 3)).toBe("noext (3)");
  });
});

describe("sanitizeFilename", () => {
  it("keeps the extension", async () => {
    const { sanitizeFilename } = await import("@/server/storage");
    expect(sanitizeFilename("photo.jpg")).toBe("photo.jpg");
  });
  it("replaces unsafe characters", async () => {
    const { sanitizeFilename } = await import("@/server/storage");
    expect(sanitizeFilename("a/b\\c:d.jpg")).toBe("a_b_c_d.jpg");
  });
  it("replaces leading dots to avoid hidden files", async () => {
    const { sanitizeFilename } = await import("@/server/storage");
    expect(sanitizeFilename("..hidden.jpg").startsWith("_")).toBe(true);
  });
  it("falls back to a default name when empty after sanitizing", async () => {
    const { sanitizeFilename } = await import("@/server/storage");
    expect(sanitizeFilename("   ")).toBe("arquivo");
  });
  it("truncates very long names but keeps extension", async () => {
    const { sanitizeFilename } = await import("@/server/storage");
    const long = "a".repeat(300) + ".jpg";
    const out = sanitizeFilename(long);
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(200);
    expect(out.endsWith(".jpg")).toBe(true);
  });
});

describe("abs() path traversal guard", () => {
  it("resolves normal relative paths under root", async () => {
    const { abs, root: getRoot } = await import("@/server/storage");
    expect(abs("staging/foo")).toBe(path.join(getRoot(), "staging/foo"));
  });
  it("blocks ../ escaping the storage root", async () => {
    const { abs } = await import("@/server/storage");
    expect(() => abs("../../etc/passwd")).toThrow(/traversal/i);
  });
  it("blocks absolute-looking escapes via nested ..", async () => {
    const { abs } = await import("@/server/storage");
    expect(() => abs("a/../../../etc/passwd")).toThrow(/traversal/i);
  });
});

describe("userFolderName", () => {
  it("slugifies display name and appends short id", async () => {
    const { userFolderName } = await import("@/server/storage");
    const out = userFolderName("Maria da Silva", "a1b2c3d4-e5f6-0000-0000-000000000000");
    expect(out).toBe("Maria-da-Silva__a1b2c3d4");
  });
  it("falls back to 'usuario' when name has no alnum chars", async () => {
    const { userFolderName } = await import("@/server/storage");
    const out = userFolderName("!!!", "a1b2c3d4-e5f6-0000-0000-000000000000");
    expect(out).toBe("usuario__a1b2c3d4");
  });
});
