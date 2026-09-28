import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupHarness, type Harness } from "./harness";
import { migrate, db } from "@/server/db";

let h: Harness;

beforeAll(async () => { h = await setupHarness(); });
afterAll(async () => { await h.teardown(); });

describe("migrate", () => {
  it("is idempotent: running again applies nothing", async () => {
    const applied = await migrate(db());
    expect(applied).toEqual([]);
  });
});
