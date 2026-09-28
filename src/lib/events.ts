"use client";
import { useEffect, useRef } from "react";
export type AppEvent =
  | { t: "upload"; uploadId: string; state: string; mediaId?: string | null; reason?: string | null }
  | { t: "media"; mediaId: string; userId: string; change: "ready" | "added" | "deleted" | "restored" }
  | { t: "package"; userId: string; packageId: string; state: string };

/** Subscribes to the backend SSE stream; EventSource reconnects on its own. */
export function useEvents(fn: (e: AppEvent) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const es = new EventSource("/api/events");
    es.onmessage = (m) => { try { ref.current(JSON.parse(m.data)); } catch {} };
    return () => es.close();
  }, []);
}
