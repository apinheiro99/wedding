import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupHarness, type Harness } from "./harness";
import { createSession, sessionFromToken, revokeSession } from "@/server/services/auth";
import { db } from "@/server/db";
import { userFolderName } from "@/server/storage";

let h: Harness;
let userId: string;

beforeAll(async () => {
  h = await setupHarness();
  const r = await db().query(
    `WITH id AS (SELECT gen_random_uuid() AS id)
     INSERT INTO users (id, email, display_name, folder_name, email_verified_at)
     SELECT id, 'session-user@example.com', 'Sess User', $1, now() FROM id RETURNING id`,
    [userFolderName("Sess User", "sessionuser")],
  );
  userId = r.rows[0].id;
});
afterAll(async () => { await h.teardown(); });

describe("session create/lookup/revoke", () => {
  it("creates a session and looks it up", async () => {
    const { token } = await createSession(userId, "USER", "test-agent");
    const u = await sessionFromToken(token, "USER");
    expect(u).not.toBeNull();
    expect(u!.id).toBe(userId);
  });

  it("returns null for a wrong session kind", async () => {
    const { token } = await createSession(userId, "USER", null);
    const u = await sessionFromToken(token, "ADMIN");
    expect(u).toBeNull();
  });

  it("revoked session no longer resolves", async () => {
    const { token } = await createSession(userId, "USER", null);
    expect(await sessionFromToken(token, "USER")).not.toBeNull();
    await revokeSession(token);
    expect(await sessionFromToken(token, "USER")).toBeNull();
  });

  it("returns null for garbage tokens", async () => {
    expect(await sessionFromToken("not-a-real-token", "USER")).toBeNull();
    expect(await sessionFromToken(undefined, "USER")).toBeNull();
  });
});
