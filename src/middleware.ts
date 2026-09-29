import { NextResponse, type NextRequest } from "next/server";

/**
 * O painel admin só é acessível pela rede local. Todo tráfego vindo da internet
 * passa pelo Cloudflare Tunnel, que sempre injeta cf-ray / cf-connecting-ip
 * (cliente externo não consegue removê-los); o acesso direto pela LAN não os tem.
 */
export function middleware(req: NextRequest) {
  const viaCloudflare = req.headers.has("cf-ray") || req.headers.has("cf-connecting-ip");
  if (!viaCloudflare) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "NOT_FOUND", message: "Não encontrado." }, { status: 404 });
  }
  return NextResponse.rewrite(new URL("/__not-found", req.url), { status: 404 });
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
