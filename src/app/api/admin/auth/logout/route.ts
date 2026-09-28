import { cookies } from "next/headers";
import { handle } from "@/server/http";
import { ADMIN_COOKIE, clearCookie, revokeSession } from "@/server/services/auth";
export const POST = handle(async () => {
  await revokeSession((await cookies()).get(ADMIN_COOKIE)?.value);
  await clearCookie(ADMIN_COOKIE);
  return Response.json({ ok: true });
});
