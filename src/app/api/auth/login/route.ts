import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { startLogin } from "@/server/services/auth";
import { clientIp, rateLimit } from "@/server/services/ratelimit";

const Body = z.object({ email: z.string().max(254) });
export const POST = handle(async (req) => {
  await rateLimit(`otp-ip:${clientIp(req)}`, 20, 3600);
  const b = await readJson(req, Body.parse);
  await rateLimit(`otp-email:${b.email.trim().toLowerCase()}`, 5, 900);
  await startLogin(b.email);
  return Response.json({ ok: true });
});
