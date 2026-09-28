export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({ status: "ok", uptime_s: Math.round(process.uptime()) });
}
