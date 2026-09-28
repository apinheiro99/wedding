"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtBytes, fmtDateTime } from "@/lib/format";
import { Badge } from "@/components/AdminShell";

type P = { id: string; label: string; state: string; dirtyReason: string | null; updatedAt: string; owner: string; version: number | null; bytes: number | null; items: number | null; versions: number };
const TONE: Record<string, "sage" | "amber" | "danger" | "muted"> = { READY: "sage", DIRTY: "amber", BUILDING: "amber", FAILED: "danger" };
export default function Packages() {
  const [p, setP] = useState<P[] | null>(null);
  const load = () => api<{ packages: P[] }>("/api/admin/packages").then((r) => setP(r.packages));
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
          <tr><th className="px-5 py-3 font-medium">Pacote</th><th className="px-3 py-3 font-medium">Estado</th><th className="px-3 py-3 font-medium">Versão atual</th><th className="px-3 py-3 font-medium">Atualizado</th><th /></tr>
        </thead>
        <tbody>
          {p?.map((x) => (
            <tr key={x.id} className="border-b border-line/50 last:border-0">
              <td className="px-5 py-3 font-medium">{x.owner} · {x.label}</td>
              <td className="px-3 py-3"><Badge tone={TONE[x.state]}>{x.state}{x.dirtyReason ? ` · ${x.dirtyReason === "DELETE" ? "exclusão" : "adição"}` : ""}</Badge></td>
              <td className="px-3 py-3 tabular-nums text-muted">{x.version ? `v${x.version} · ${fmtBytes(x.bytes)} · ${x.items} arq.` : "—"} <span className="text-xs">({x.versions} versões)</span></td>
              <td className="px-3 py-3 text-muted">{fmtDateTime(x.updatedAt)}</td>
              <td className="px-3 py-3 text-right"><button className="rounded-full px-3 py-1 text-xs text-muted hover:bg-ivory-deep hover:text-ink" onClick={async () => { await api(`/api/admin/packages/${x.id}/rebuild`, { method: "POST" }); load(); }}>Reconstruir</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {p?.length === 0 && <p className="p-10 text-center text-muted">Nenhum pacote ainda.</p>}
    </div>
  );
}
