import { z } from "zod";
import { handle, readJson } from "@/server/http";
import { adminLogin, createSession, setSessionCookie } from "@/server/services/auth";
import { clientIp, rateLimit } from "@/server/services/ratelimit";
const Body = z.object({ email: z.string().max(254), password: z.string().max(200) });
export const POST = handle(async (req) => {
  await rateLimit(`admin:${clientIp(req)}`, 10, 900);
  const b = await readJson(req, Body.parse);
  const id = await adminLogin(b.email, b.password);
  const s = await createSession(id, "ADMIN", req.headers.get("user-agent"));
  await setSessionCookie("ADMIN", s.token, s.maxAge);
  return Response.json({ ok: true });
});
