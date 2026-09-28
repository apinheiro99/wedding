import { describe, it, expect } from "vitest";
import { evaluateOtp, normalizeEmail, isValidEmail, type OtpChallengeState } from "@/server/domain/otp";

const base = (over: Partial<OtpChallengeState> = {}): OtpChallengeState => ({
  attempts: 0,
  expiresAt: new Date(Date.now() + 10 * 60_000),
  consumedAt: null,
  supersededAt: null,
  ...over,
});

describe("evaluateOtp", () => {
  it("OK when code matches and nothing wrong", () => {
    expect(evaluateOtp(base(), true, new Date(), 5)).toBe("OK");
  });
  it("WRONG when code does not match", () => {
    expect(evaluateOtp(base(), false, new Date(), 5)).toBe("WRONG");
  });
  it("USED when already consumed", () => {
    expect(evaluateOtp(base({ consumedAt: new Date() }), true, new Date(), 5)).toBe("USED");
  });
  it("EXPIRED when superseded", () => {
    expect(evaluateOtp(base({ supersededAt: new Date() }), true, new Date(), 5)).toBe("EXPIRED");
  });
  it("EXPIRED when now is past expiresAt", () => {
    const c = base({ expiresAt: new Date(Date.now() - 1000) });
    expect(evaluateOtp(c, true, new Date(), 5)).toBe("EXPIRED");
  });
  it("TOO_MANY_ATTEMPTS when attempts >= maxAttempts", () => {
    const c = base({ attempts: 5 });
    expect(evaluateOtp(c, true, new Date(), 5)).toBe("TOO_MANY_ATTEMPTS");
  });
  it("USED takes priority over expired/superseded checks", () => {
    const c = base({ consumedAt: new Date(), supersededAt: new Date(), expiresAt: new Date(Date.now() - 1000) });
    expect(evaluateOtp(c, true, new Date(), 5)).toBe("USED");
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Foo@Bar.COM  ")).toBe("foo@bar.com");
  });
});

describe("isValidEmail", () => {
  it("accepts a simple valid email", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
  });
  it("rejects missing @ or domain dot", () => {
    expect(isValidEmail("nope")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
  it("rejects overly long emails", () => {
    const long = "a".repeat(250) + "@b.com";
    expect(isValidEmail(long)).toBe(false);
  });
});
