import { db } from "../db";
import { HttpError } from "../http";

/** Fixed-window counter persisted in PostgreSQL. */
export async function rateLimit(key: string, max: number, windowSec: number) {
  const r = await db().query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2) THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [key, windowSec],
  );
  if (r.rows[0].count > max) throw new HttpError(429, "RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos.");
}

export function clientIp(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}
