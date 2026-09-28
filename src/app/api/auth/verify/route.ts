import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { clearCookie, createSession, ONBOARD_COOKIE, setSessionCookie, verifyOtp } from "@/server/services/auth";
import { clientIp, rateLimit } from "@/server/services/ratelimit";

const Body = z.object({ email: z.string().max(254), code: z.string().max(10) });
export const POST = handle(async (req) => {
  await rateLimit(`verify:${clientIp(req)}`, 30, 600);
  const b = await readJson(req, Body.parse);
  const userId = await verifyOtp(b.email, b.code.trim());
  const s = await createSession(userId, "USER", req.headers.get("user-agent"));
  await setSessionCookie("USER", s.token, s.maxAge);
  await clearCookie(ONBOARD_COOKIE);
  return Response.json({ ok: true });
});
