import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { setupHarness, type Harness } from "./harness";
import { db } from "@/server/db";
import { abs, userFolderName } from "@/server/storage";
import { createUpload, appendChunk } from "@/server/services/uploads";
import { finalizeUpload } from "@/server/services/media";
import { buildPackage, markDirty } from "@/server/services/packages";

let h: Harness;
let userId: string;

beforeAll(async () => {
  h = await setupHarness();
  const r = await db().query(
    `WITH id AS (SELECT gen_random_uuid() AS id)
     INSERT INTO users (id, email, display_name, folder_name, email_verified_at)
     SELECT id, 'pkg-user@example.com', 'Pkg User', $1, now() FROM id RETURNING id`,
    [userFolderName("Pkg User", "pkguser")],
  );
  userId = r.rows[0].id;
});
afterAll(async () => { await h.teardown(); });

async function uploadFile(filename: string, size: number) {
  const buf = crypto.randomBytes(size);
  const created = await createUpload(userId, { filename, size: buf.length, mime: "application/octet-stream" });
  await appendChunk(userId, created.id, 0, new Blob([new Uint8Array(buf)]).stream() as any);
  const state = await finalizeUpload(created.id);
  expect(state).toBe("COMPLETE");
  const row = (await db().query("SELECT media_id, package_id FROM uploads u JOIN media m ON m.id = u.media_id WHERE u.id = $1", [created.id])).rows[0];
  return row as { media_id: string; package_id: string };
}

describe("packages: allocation and build", () => {
  it("first file opens package 01; a file that would exceed target opens package 02", async () => {
    // PACKAGE_TARGET_BYTES = 50000 in the test harness config
    const a = await uploadFile("a.bin", 30000);
    const b = await uploadFile("b.bin", 30000); // 30000+30000 > 50000 -> new package
    expect(b.package_id).not.toBe(a.package_id);

    const pkgs = (await db().query("SELECT id, sequence_no FROM packages WHERE user_id = $1 ORDER BY sequence_no", [userId])).rows;
    expect(pkgs).toHaveLength(2);
    expect(pkgs[0].sequence_no).toBe(1);
    expect(pkgs[1].sequence_no).toBe(2);

    const built = await buildPackage(a.package_id);
    expect(built).toBe("BUILT");

    const pkgRow = (await db().query("SELECT state, current_version_id FROM packages WHERE id = $1", [a.package_id])).rows[0];
    expect(pkgRow.state).toBe("READY");
    const version = (await db().query("SELECT relative_path, item_count FROM package_versions WHERE id = $1", [pkgRow.current_version_id])).rows[0];
    expect(version.item_count).toBe(1);

    const zipPath = abs(version.relative_path);
    const listing = execFileSync("unzip", ["-l", zipPath]).toString();
    expect(listing).toContain("a.bin");

    // New uploads always land in the highest-sequence package if they fit (assignToPackage
    // always looks at sequence_no DESC), so to add a file to package `a` specifically (which
    // is no longer the last one) we attach it directly and call markDirty, exactly as
    // assignToPackage would for that package.
    const cMedia = await db().query(
      `INSERT INTO media (uploader_user_id, sha256, original_filename, stored_filename, relative_path, byte_size, media_kind, sort_at, capture_at_source)
       VALUES ($1, $2, 'c.bin', 'c.bin', $3, 100, 'OTHER', now(), 'UPLOAD') RETURNING id`,
      [userId, crypto.randomBytes(32).toString("hex"), `originals/users/${userFolderName("Pkg User", "pkguser")}/c.bin`],
    );
    const cMediaId = cMedia.rows[0].id;
    await fs.writeFile(abs(`originals/users/${userFolderName("Pkg User", "pkguser")}/c.bin`), crypto.randomBytes(100));
    await db().query("INSERT INTO package_items (package_id, media_id, ordinal) VALUES ($1, $2, 2)", [a.package_id, cMediaId]);
    await db().query("UPDATE media SET package_id = $1 WHERE id = $2", [a.package_id, cMediaId]);
    await markDirty(db(), a.package_id, "ADD");

    const afterAdd = (await db().query("SELECT state FROM packages WHERE id = $1", [a.package_id])).rows[0];
    expect(afterAdd.state).toBe("DIRTY");

    const oldVersionId = pkgRow.current_version_id;
    const built2 = await buildPackage(a.package_id);
    expect(built2).toBe("BUILT");

    const pkgRow2 = (await db().query("SELECT state, current_version_id FROM packages WHERE id = $1", [a.package_id])).rows[0];
    expect(pkgRow2.state).toBe("READY");
    expect(pkgRow2.current_version_id).not.toBe(oldVersionId);

    const oldVersion = (await db().query("SELECT state, relative_path FROM package_versions WHERE id = $1", [oldVersionId])).rows[0];
    expect(oldVersion.state).toBe("RETIRED");
    // old zip file must still exist on disk (download-in-progress safety)
    await fs.access(abs(oldVersion.relative_path));

    const newVersion = (await db().query("SELECT relative_path, item_count FROM package_versions WHERE id = $1", [pkgRow2.current_version_id])).rows[0];
    expect(newVersion.item_count).toBe(2);
    const listing2 = execFileSync("unzip", ["-l", abs(newVersion.relative_path)]).toString();
    expect(listing2).toContain("a.bin");
    expect(listing2).toContain("c.bin");
  });
});
