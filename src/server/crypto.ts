import crypto from "node:crypto";
import argon2 from "argon2";

export const hashPassword = (p: string) => argon2.hash(p, { type: argon2.argon2id });
export const verifyPassword = async (hash: string, p: string) => {
  try { return await argon2.verify(hash, p); } catch { return false; }
};
export const randomToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256Hex = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
export function hmac(secret: string, s: string) {
  return crypto.createHmac("sha256", secret).update(s).digest("hex");
}
export function otpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}
export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
