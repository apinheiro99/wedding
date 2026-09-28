import { log } from "./log";
import crypto from "node:crypto";

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
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) checkCsrf(req);
      const res = await fn(req, ctx);
      res.headers.set("x-request-id", rid);
      return res;
    } catch (e) {
      if (e instanceof HttpError) {
        return Response.json({ error: e.code, message: e.message }, { status: e.status, headers: { "x-request-id": rid } });
      }
      log.error("http.unhandled", { rid, path: new URL(req.url).pathname, error: (e as Error).message, stack: (e as Error).stack });
      return Response.json({ error: "INTERNAL", message: "Erro interno. Tente novamente." }, { status: 500, headers: { "x-request-id": rid } });
    }
  };
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
