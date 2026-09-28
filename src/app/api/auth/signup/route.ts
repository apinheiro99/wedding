import { z } from "zod";
import { cookies } from "next/headers";
import { handle, readJson, HttpError } from "@/server/http";
import { hasOnboardingGrant, ONBOARD_COOKIE, startSignup } from "@/server/services/auth";
import { clientIp, rateLimit } from "@/server/services/ratelimit";

const Body = z.object({ displayName: z.string().max(100), email: z.string().max(254) });
export const POST = handle(async (req) => {
  if (!(await hasOnboardingGrant((await cookies()).get(ONBOARD_COOKIE)?.value)))
    throw new HttpError(403, "FAMILY_GATE_REQUIRED", "Confirme primeiro o acesso da família.");
  await rateLimit(`otp-ip:${clientIp(req)}`, 20, 3600);
  const b = await readJson(req, Body.parse);
  await rateLimit(`otp-email:${b.email.trim().toLowerCase()}`, 5, 900);
  await startSignup(b.email, b.displayName);
  return Response.json({ ok: true });
});
