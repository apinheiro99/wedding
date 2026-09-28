"use client";
import { useSyncExternalStore } from "react";
import { initials, personColor } from "@/lib/format";

// Tiny shared store of avatar versions (one request per page load).
let versions: Record<string, number> = {};
let loaded = false;
const subs = new Set<() => void>();
export function reloadAvatars() {
  loaded = true;
  fetch("/api/avatars").then((r) => (r.ok ? r.json() : { versions: {} })).then((d) => { versions = d.versions ?? {}; subs.forEach((f) => f()); }).catch(() => {});
}
function subscribe(f: () => void) { subs.add(f); if (!loaded) reloadAvatars(); return () => { subs.delete(f); }; }

export function Avatar({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  const v = useSyncExternalStore(subscribe, () => versions[id], () => undefined);
  if (v) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/users/${id}/avatar?v=${v}`} alt="" aria-hidden width={size} height={size} className="inline-block shrink-0 rounded-full object-cover ring-2 ring-card" style={{ width: size, height: size }} />;
  }
  return (
    <span aria-hidden className="inline-grid shrink-0 place-items-center rounded-full font-medium text-white ring-2 ring-card"
      style={{ width: size, height: size, background: personColor(id), fontSize: size * 0.38 }}>{initials(name)}</span>
  );
}
