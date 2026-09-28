import { readiness } from "@/server/services/health";
export const dynamic = "force-dynamic";
export async function GET() {
  const r = await readiness();
  return Response.json(r, { status: r.ready ? 200 : 503 });
}
