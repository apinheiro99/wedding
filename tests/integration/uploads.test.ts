import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { setupHarness, type Harness } from "./harness";
import { db } from "@/server/db";
import { abs, userFolderName } from "@/server/storage";
import { createUpload, appendChunk, checkHash } from "@/server/services/uploads";
import { finalizeUpload, softDelete } from "@/server/services/media";

let h: Harness;
let userId: string;
let folderName: string;

beforeAll(async () => {
  h = await setupHarness();
  folderName = userFolderName("Upload User", "uploaduser");
  const r = await db().query(
    `WITH id AS (SELECT gen_random_uuid() AS id)
     INSERT INTO users (id, email, display_name, folder_name, email_verified_at)
     SELECT id, 'upload-user@example.com', 'Upload User', $1, now() FROM id RETURNING id`,
    [folderName],
  );
  userId = r.rows[0].id;
});
afterAll(async () => { await h.teardown(); });

function sha256(buf: Buffer) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function uploadWholeFile(filename: string, buf: Buffer) {
  const created = await createUpload(userId, { filename, size: buf.length, mime: "application/octet-stream" });
  const half = Math.ceil(buf.length / 2) || 0;
  if (buf.length === 0) {
    return created;
  }
  const chunk1 = buf.subarray(0, half);
  const chunk2 = buf.subarray(half);
  const r1 = await appendChunk(userId, created.id, 0, new Blob([new Uint8Array(chunk1)]).stream() as any);
  expect(r1.offset).toBe(chunk1.length);
  if (chunk2.length > 0) {
    const r2 = await appendChunk(userId, created.id, chunk1.length, new Blob([new Uint8Array(chunk2)]).stream() as any);
    expect(r2.complete).toBe(true);
  }
  return created;
}

describe("upload lifecycle", () => {
  it("createUpload -> appendChunk (2 chunks, offset mismatch -> 409) -> finalizeUpload -> COMPLETE", async () => {
    const buf = crypto.randomBytes(1000);
    const created = await createUpload(userId, { filename: "photo1.jpg", size: buf.length, mime: "image/jpeg" });
    const chunk1 = buf.subarray(0, 400);
    const chunk2 = buf.subarray(400);

    // wrong offset -> 409 with real offset
    await expect(appendChunk(userId, created.id, 999, new Blob([new Uint8Array(chunk1)]).stream() as any)).rejects.toMatchObject({ status: 409, code: "OFFSET_MISMATCH" });

    const r1 = await appendChunk(userId, created.id, 0, new Blob([new Uint8Array(chunk1)]).stream() as any);
    expect(r1.offset).toBe(400);
    expect(r1.complete).toBe(false);

    const r2 = await appendChunk(userId, created.id, 400, new Blob([new Uint8Array(chunk2)]).stream() as any);
    expect(r2.offset).toBe(buf.length);
    expect(r2.complete).toBe(true);

    const state = await finalizeUpload(created.id);
    expect(state).toBe("COMPLETE");

    const row = (await db().query("SELECT media_id, state FROM uploads WHERE id = $1", [created.id])).rows[0];
    expect(row.state).toBe("COMPLETE");
    const media = (await db().query("SELECT relative_path, sha256 FROM media WHERE id = $1", [row.media_id])).rows[0];
    expect(media.sha256).toBe(sha256(buf));

    const onDisk = await fs.readFile(abs(media.relative_path));
    expect(sha256(onDisk)).toBe(sha256(buf));
    expect(media.relative_path).toBe(`originals/users/${folderName}/photo1.jpg`);
  });

  it("uploading the exact same bytes again is detected as DUPLICATE, no new file", async () => {
    const buf = crypto.randomBytes(500);
    await uploadWholeFile("dup.jpg", buf);
    const first = await finalizeUpload((await db().query(
      "SELECT id FROM uploads WHERE user_id = $1 AND original_filename = 'dup.jpg' ORDER BY created_at DESC LIMIT 1", [userId],
    )).rows[0].id);
    expect(first).toBe("COMPLETE");

    const check = await checkHash(userId, sha256(buf));
    expect(check.status).toBe("DUPLICATE_ACTIVE");

    const filesBefore = await fs.readdir(abs(`originals/users/${folderName}`));

    const second = await uploadWholeFile("dup2.jpg", buf);
    const state = await finalizeUpload(second.id);
    expect(state).toBe("DUPLICATE");

    const filesAfter = await fs.readdir(abs(`originals/users/${folderName}`));
    expect(filesAfter.sort()).toEqual(filesBefore.sort());
  });

  it("same filename with different bytes is stored with a collision suffix", async () => {
    const buf1 = crypto.randomBytes(200);
    const buf2 = crypto.randomBytes(201);
    const up1 = await uploadWholeFile("collide.jpg", buf1);
    expect(await finalizeUpload(up1.id)).toBe("COMPLETE");
    const up2 = await uploadWholeFile("collide.jpg", buf2);
    expect(await finalizeUpload(up2.id)).toBe("COMPLETE");

    const rows = (await db().query(
      "SELECT stored_filename FROM media WHERE uploader_user_id = $1 AND original_filename = 'collide.jpg' ORDER BY created_at",
      [userId],
    )).rows;
    expect(rows.map((r) => r.stored_filename)).toEqual(["collide.jpg", "collide (1).jpg"]);
  });

  it("soft-deleting keeps the file on disk; re-upload of the same bytes RESTORES it", async () => {
    const buf = crypto.randomBytes(300);
    const up = await uploadWholeFile("restore-me.jpg", buf);
    await finalizeUpload(up.id);
    const media = (await db().query(
      "SELECT id, relative_path FROM media WHERE uploader_user_id = $1 AND sha256 = $2", [userId, sha256(buf)],
    )).rows[0];

    await softDelete(media.id, { id: userId, isAdmin: false });
    const afterDelete = await db().query("SELECT deleted_at FROM media WHERE id = $1", [media.id]);
    expect(afterDelete.rows[0].deleted_at).not.toBeNull();
    // file still on disk
    await fs.access(abs(media.relative_path));

    const up2 = await uploadWholeFile("restore-me-2.jpg", buf);
    const state = await finalizeUpload(up2.id);
    expect(state).toBe("RESTORED");

    const afterRestore = await db().query("SELECT deleted_at FROM media WHERE id = $1", [media.id]);
    expect(afterRestore.rows[0].deleted_at).toBeNull();
  });
});
