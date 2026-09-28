import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import crypto from "node:crypto";
import { setupHarness, type Harness } from "./harness";
import { db } from "@/server/db";
import { userFolderName } from "@/server/storage";
import { runDigest } from "@/server/services/notifications";
import { memoryOutbox } from "@/server/email";

let h: Harness;
let userA: string, userB: string;

beforeAll(async () => {
  h = await setupHarness();
  const mk = async (email: string, name: string) => {
    const r = await db().query(
      `WITH id AS (SELECT gen_random_uuid() AS id)
       INSERT INTO users (id, email, display_name, folder_name, email_verified_at)
       SELECT id, $1, $2, $3, now() FROM id RETURNING id`,
      [email, name, userFolderName(name, email)],
    );
    return r.rows[0].id as string;
  };
  userA = await mk("digest-a@example.com", "Ana");
  userB = await mk("digest-b@example.com", "Beto");
});
afterAll(async () => { await h.teardown(); });
beforeEach(() => { memoryOutbox.length = 0; });

async function insertActivity(userId: string, filename: string) {
  const folder = (await db().query("SELECT folder_name FROM users WHERE id = $1", [userId])).rows[0].folder_name;
  const media = await db().query(
    `INSERT INTO media (uploader_user_id, sha256, original_filename, stored_filename, relative_path, byte_size, media_kind, sort_at, capture_at_source)
     VALUES ($1, $2, $3, $3, $4, 123, 'IMAGE', now(), 'UPLOAD') RETURNING id`,
    [userId, crypto.randomUUID().replace(/-/g, "").padEnd(64, "0"), filename, `originals/users/${folder}/${filename}`],
  );
  const mediaId = media.rows[0].id;
  await db().query(
    `INSERT INTO notification_activity (user_id, media_id, media_kind, byte_size, created_at)
     VALUES ($1, $2, 'IMAGE', 123, now() - interval '20 minutes')`,
    [userId, mediaId],
  );
}

describe("notification digest", () => {
  it("sends each recipient only the other person's lines, and does not resend on a second run", async () => {
    await insertActivity(userA, "a1.jpg");
    await insertActivity(userB, "b1.jpg");

    const sent = await runDigest();
    expect(sent).toBe(2); // both A and B receive a mail about the other

    const toA = memoryOutbox.find((m) => m.to === "digest-a@example.com");
    const toB = memoryOutbox.find((m) => m.to === "digest-b@example.com");
    expect(toA).toBeTruthy();
    expect(toB).toBeTruthy();
    expect(toA!.text).toContain("Beto");
    expect(toA!.text).not.toContain("Ana adicionou");
    expect(toB!.text).toContain("Ana");
    expect(toB!.text).not.toContain("Beto adicionou");

    memoryOutbox.length = 0;
    const sentAgain = await runDigest();
    expect(sentAgain).toBe(0);
    expect(memoryOutbox).toHaveLength(0);
  });
});
