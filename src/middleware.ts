import { NextResponse, type NextRequest } from "next/server";

/**
 * O painel admin (`/admin`, `/api/admin`) não pode ser alcançado da internet.
 *
 * Dois modos:
 *
 * 1. Forte (recomendado) — defina `ADMIN_TUNNEL_SECRET`. O admin só responde quando a requisição
 *    traz `x-tunnel-auth` igual ao segredo (injetado pelo hop confiável, ex. Cloudflare Tunnel/Access).
 *    Fecha o bypass por acesso direto à origem, mesmo que o atacante forje headers `cf-*`/`x-forwarded-for`.
 *
 * 2. Legado (padrão, se o segredo não estiver definido) — assume que todo tráfego da internet passa
 *    pelo Cloudflare (que injeta `cf-ray`/`cf-connecting-ip`) e que o acesso pela LAN não os tem.
 *    É best-effort: fail-open se a origem ficar exposta diretamente à internet.
 */
export function middleware(req: NextRequest) {
  const secret = process.env.ADMIN_TUNNEL_SECRET;

  if (secret) {
    const provided = req.headers.get("x-tunnel-auth") ?? "";
    return safeEqual(provided, secret) ? NextResponse.next() : block(req);
  }

  const viaCloudflare = req.headers.has("cf-ray") || req.headers.has("cf-connecting-ip");
  if (!viaCloudflare) return NextResponse.next();
  return block(req);
}

function block(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return Response.json({ error: "NOT_FOUND", message: "Não encontrado." }, { status: 404 });
  }
  return NextResponse.rewrite(new URL("/__not-found", req.url), { status: 404 });
}

/** Constant-time compare (edge runtime has no node:crypto timingSafeEqual). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
