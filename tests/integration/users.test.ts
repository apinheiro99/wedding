import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupHarness, type Harness } from "./harness";
import { db } from "@/server/db";
import { userFolderName } from "@/server/storage";

let h: Harness;

beforeAll(async () => { h = await setupHarness(); });
afterAll(async () => { await h.teardown(); });

async function insertUser(email: string, name: string) {
  const r = await db().query(
    `WITH id AS (SELECT gen_random_uuid() AS id)
     INSERT INTO users (id, email, display_name, folder_name) SELECT id, $1, $2, $3 || left(id::text,8) FROM id RETURNING id`,
    [email, name, userFolderName(name, "").replace(/^$/, "user_")],
  );
  return r.rows[0].id as string;
}

describe("unique email constraint", () => {
  it("is case-insensitive", async () => {
    await insertUser("Foo@Example.com", "Foo");
    await expect(insertUser("foo@example.com", "Foo2")).rejects.toThrow();
  });
});
