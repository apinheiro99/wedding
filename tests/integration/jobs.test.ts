import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setupHarness, type Harness } from "./harness";
import { enqueue, claim, fail, complete } from "@/server/services/jobs";
import { db } from "@/server/db";

let h: Harness;

beforeAll(async () => { h = await setupHarness(); });
afterAll(async () => { await h.teardown(); });

describe("jobs", () => {
  it("enqueue with the same dedupeKey twice keeps a single pending job", async () => {
    await enqueue("PACKAGE_BUILD", { packageId: "x" }, { dedupeKey: "dedupe-test-1" });
    await enqueue("PACKAGE_BUILD", { packageId: "x" }, { dedupeKey: "dedupe-test-1" });
    const r = await db().query("SELECT count(*)::int AS n FROM jobs WHERE dedupe_key = 'dedupe-test-1' AND state = 'PENDING'");
    expect(r.rows[0].n).toBe(1);
  });

  it("claim uses SKIP LOCKED so a concurrent claim never returns the same job", async () => {
    await enqueue("CLEANUP", {}, { dedupeKey: "claim-test-a" });
    await enqueue("CLEANUP", {}, { dedupeKey: "claim-test-b" });
    const [j1, j2] = await Promise.all([claim(["CLEANUP"]), claim(["CLEANUP"])]);
    expect(j1).not.toBeNull();
    expect(j2).not.toBeNull();
    expect(j1!.id).not.toBe(j2!.id);
    await complete(j1!.id);
    await complete(j2!.id);
  });

  it("claim returns null when nothing is pending", async () => {
    await db().query("DELETE FROM jobs WHERE type = 'DAILY_REPORT'");
    const j = await claim(["DAILY_REPORT"]);
    expect(j).toBeNull();
  });

  it("fail() retries with PENDING state and increments attempts, then FAILED at max attempts", async () => {
    await enqueue("MEDIA_PROCESS", { mediaId: "m1" }, { dedupeKey: "fail-test-1" });
    await db().query("UPDATE jobs SET max_attempts = 2 WHERE dedupe_key = 'fail-test-1'");

    let job = await claim(["MEDIA_PROCESS"]);
    expect(job).not.toBeNull();
    expect(job!.attempts).toBe(1);
    await fail(job!, "boom-1");

    const afterFirstFail = (await db().query("SELECT state, attempts FROM jobs WHERE id = $1", [job!.id])).rows[0];
    expect(afterFirstFail.state).toBe("PENDING");

    // second claim/fail should hit max_attempts and go FAILED
    await db().query("UPDATE jobs SET available_at = now() WHERE id = $1", [job!.id]);
    job = await claim(["MEDIA_PROCESS"]);
    expect(job!.attempts).toBe(2);
    await fail(job!, "boom-2");

    const final = (await db().query("SELECT state FROM jobs WHERE id = $1", [job!.id])).rows[0];
    expect(final.state).toBe("FAILED");
  });
});
