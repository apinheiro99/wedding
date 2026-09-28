"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { Badge } from "@/components/AdminShell";

type J = { id: number; type: string; payload: object; state: string; attempts: number; max_attempts: number; last_error: string | null; created_at: string };
const TONE: Record<string, "sage" | "amber" | "danger" | "muted"> = { DONE: "sage", PENDING: "muted", RUNNING: "amber", FAILED: "danger" };
export default function Jobs() {
  const [state, setState] = useState<string>("FAILED");
  const [d, setD] = useState<{ jobs: J[]; counts: Record<string, number> } | null>(null);
  const load = useCallback(() => api<typeof d>(`/api/admin/jobs?state=${state}`).then(setD), [state]);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {["FAILED", "PENDING", "RUNNING", "DONE"].map((s) => (
          <button key={s} onClick={() => setState(s)} className={`rounded-full border px-4 py-1.5 text-sm ${state === s ? "border-ink bg-ink text-ivory" : "border-line bg-card text-muted"}`}>
            {s} <span className="opacity-60">{d?.counts[s] ?? 0}</span>
          </button>
        ))}
      </div>
      <div className="card divide-y divide-line/60">
        {d?.jobs.map((j) => (
          <div key={j.id} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">#{j.id} {j.type} <Badge tone={TONE[j.state]}>{j.state}</Badge> <span className="text-xs text-muted">tentativa {j.attempts}/{j.max_attempts}</span></p>
              <p className="mt-1 truncate font-mono text-xs text-muted">{JSON.stringify(j.payload)}</p>
              {j.last_error && <p className="mt-1 break-words font-mono text-xs text-danger">{j.last_error}</p>}
              <p className="mt-1 text-xs text-muted">{fmtDateTime(j.created_at)}</p>
            </div>
            {j.state === "FAILED" && <button className="btn-ghost btn-sm" onClick={async () => { await api(`/api/admin/jobs/${j.id}/retry`, { method: "POST" }); load(); }}>↻ Repetir</button>}
          </div>
        ))}
        {d?.jobs.length === 0 && <p className="p-10 text-center text-muted">{state === "FAILED" ? "Nenhum job falho. ✦" : "Nada aqui."}</p>}
      </div>
    </>
  );
}
