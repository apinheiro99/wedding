import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { checkFamilyCredential, setOnboardingCookie } from "@/server/services/auth";
import { clientIp, rateLimit } from "@/server/services/ratelimit";

const Body = z.object({ login: z.string().max(200), password: z.string().max(200) });
export const POST = handle(async (req) => {
  await rateLimit(`family:${clientIp(req)}`, 10, 600);
  const b = await readJson(req, Body.parse);
  await setOnboardingCookie(await checkFamilyCredential(b.login, b.password));
  return Response.json({ ok: true });
});
