import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { setupHarness, type Harness } from "./harness";
import { startSignup, verifyOtp, createOtp } from "@/server/services/auth";
import { memoryOutbox } from "@/server/email";
import { db } from "@/server/db";

let h: Harness;

beforeAll(async () => { h = await setupHarness(); });
afterAll(async () => { await h.teardown(); });
beforeEach(() => { memoryOutbox.length = 0; });

function lastCode() {
  const mail = memoryOutbox[memoryOutbox.length - 1];
  const m = mail.text.match(/(\d{6})/);
  if (!m) throw new Error("no code found in mail: " + mail.text);
  return m[1];
}

describe("OTP lifecycle", () => {
  it("signup creates a user on correct code", async () => {
    await startSignup("alice@example.com", "Alice");
    expect(memoryOutbox).toHaveLength(1);
    const code = lastCode();
    const userId = await verifyOtp("alice@example.com", code);
    expect(userId).toBeTruthy();
    const r = await db().query("SELECT email FROM users WHERE id = $1", [userId]);
    expect(r.rows[0].email).toBe("alice@example.com");
  });

  it("wrong code increments attempts, and 5 wrong attempts lock the challenge", async () => {
    await startSignup("bob@example.com", "Bob");
    for (let i = 0; i < 5; i++) {
      await expect(verifyOtp("bob@example.com", "000000")).rejects.toMatchObject({ code: "OTP_WRONG" });
    }
    // 6th attempt: attempts counter has reached max, now locked
    await expect(verifyOtp("bob@example.com", "000000")).rejects.toMatchObject({ code: "OTP_LOCKED" });
    // even the correct code now fails because it's locked
    const code = lastCode();
    await expect(verifyOtp("bob@example.com", code)).rejects.toMatchObject({ code: "OTP_LOCKED" });
  });

  it("reusing an already-consumed code fails", async () => {
    await startSignup("carol@example.com", "Carol");
    const code = lastCode();
    await verifyOtp("carol@example.com", code);
    await expect(verifyOtp("carol@example.com", code)).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("a new OTP supersedes the old one: the old code no longer matches the active challenge", async () => {
    await startSignup("dave@example.com", "Dave");
    const oldCode = lastCode();
    const newCode = await createOtp("dave@example.com", "SIGNUP", "Dave");
    // verifyOtp only ever looks at the latest non-superseded challenge, so the old
    // code is simply treated as a wrong guess against the new one (never EXPIRED).
    await expect(verifyOtp("dave@example.com", oldCode)).rejects.toMatchObject({ code: "OTP_WRONG" });
    const userId = await verifyOtp("dave@example.com", newCode);
    expect(userId).toBeTruthy();
  });
});
