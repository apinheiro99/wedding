import { requireUser } from "@/server/services/auth";
import { subscribe, type AppEvent } from "@/server/services/events";
import { handle } from "@/server/http";
export const dynamic = "force-dynamic";
/** SSE: live upload/media/package state. Upload events only go to their owner. */
export const GET = handle(async (req) => {
  const u = await requireUser();
  const enc = new TextEncoder();
  let unsub = () => {};
  let ping: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(ctrl) {
      const send = (e: AppEvent) => {
        if (e.t === "upload" && e.userId !== u.id) return;
        try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ }
      };
      unsub = subscribe(send);
      ctrl.enqueue(enc.encode(": ok\n\n"));
      ping = setInterval(() => { try { ctrl.enqueue(enc.encode(": ping\n\n")); } catch { /* closed */ } }, 25_000);
      req.signal.addEventListener("abort", () => { unsub(); clearInterval(ping); try { ctrl.close(); } catch {} });
    },
    cancel() { unsub(); clearInterval(ping); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
});
