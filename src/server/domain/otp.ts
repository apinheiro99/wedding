// Pure OTP decision logic (unit tested).
export type OtpChallengeState = {
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  supersededAt: Date | null;
};

export type OtpDecision = "OK" | "WRONG" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "USED";

export function evaluateOtp(c: OtpChallengeState, codeMatches: boolean, now: Date, maxAttempts: number): OtpDecision {
  if (c.consumedAt) return "USED";
  if (c.supersededAt) return "EXPIRED";
  if (now >= c.expiresAt) return "EXPIRED";
  if (c.attempts >= maxAttempts) return "TOO_MANY_ATTEMPTS";
  return codeMatches ? "OK" : "WRONG";
}

export function normalizeEmail(e: string) {
  return e.trim().toLowerCase();
}

export function isValidEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}
