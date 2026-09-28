import { cookies } from "next/headers";
import { handle } from "@/server/http";
import { clearCookie, revokeSession, USER_COOKIE } from "@/server/services/auth";
export const POST = handle(async () => {
  await revokeSession((await cookies()).get(USER_COOKIE)?.value);
  await clearCookie(USER_COOKIE);
  return Response.json({ ok: true });
});
