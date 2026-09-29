import { log } from "./log";
import crypto from "node:crypto";
import { runWithContext } from "./context";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const badRequest = (m: string, code = "BAD_REQUEST") => new HttpError(400, code, m);
export const unauthorized = (m = "Faça login para continuar.") => new HttpError(401, "UNAUTHORIZED", m);
export const forbidden = (m = "Sem permissão.") => new HttpError(403, "FORBIDDEN", m);
export const notFound = (m = "Não encontrado.") => new HttpError(404, "NOT_FOUND", m);

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Error mapping + correlation id + CSRF guard for state-changing requests. */
export function handle<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const rid = req.headers.get("x-request-id") ?? crypto.randomUUID().slice(0, 8);
    const t0 = Date.now();
    const path = new URL(req.url).pathname;
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? undefined;
    const ua = req.headers.get("user-agent")?.slice(0, 200) ?? undefined;
    return runWithContext({ rid, ip, ua }, () => run(req, ctx, rid, t0, path));
  };

  async function run(req: Request, ctx: C, rid: string, t0: number, path: string): Promise<Response> {
    const l = log.child("http", { method: req.method, path });
    // access log: every request at info (who = ip/user/role come from the request context); probes stay at debug
    const quiet = path === "/ready" || path === "/health";
    const done = (status: number) => {
      const d = { status, ms: Date.now() - t0 };
      if (status >= 500) l.error("request", d);
      else if (status >= 400) l.warn("request", d);
      else if (d.ms > 2000) l.warn("request.slow", d);
      else if (quiet) l.debug("request", d);
      else l.info("request", d);
    };
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) checkCsrf(req);
      const res = await fn(req, ctx);
      res.headers.set("x-request-id", rid);
      done(res.status);
      return res;
    } catch (e) {
      if (e instanceof HttpError) {
        l.debug("http_error", { code: e.code, reason: e.message });
        done(e.status);
        return Response.json({ error: e.code, message: e.message }, { status: e.status, headers: { "x-request-id": rid } });
      }
      l.error("unhandled", { err: e });
      done(500);
      return Response.json({ error: "INTERNAL", message: "Erro interno. Tente novamente." }, { status: 500, headers: { "x-request-id": rid } });
    }
  }
}

/** SameSite=Lax cookies + require same-origin header for mutations. */
function checkCsrf(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin) {
    let oh: string;
    try { oh = new URL(origin).host; } catch { throw new HttpError(403, "CSRF", "Origem inválida."); }
    if (oh !== host) throw new HttpError(403, "CSRF", "Origem inválida.");
  } else if (!req.headers.get("x-requested-with") && !req.headers.get("tus-resumable")) {
    throw new HttpError(403, "CSRF", "Requisição inválida.");
  }
}

export async function readJson<T>(req: Request, parse: (x: unknown) => T): Promise<T> {
  let body: unknown;
  try { body = await req.json(); } catch { throw badRequest("JSON inválido."); }
  try { return parse(body); } catch { throw badRequest("Dados inválidos."); }
}
