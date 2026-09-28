"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { fmtBytes, fmtDateTime } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { Badge } from "@/components/AdminShell";

type U = { id: string; email: string; displayName: string; role: string; status: string; createdAt: string; active: number; deleted: number; bytes: number; lastSeen: string | null };
export default function Users() {
  const [users, setUsers] = useState<U[] | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const load = () => api<{ users: U[] }>("/api/admin/users").then((r) => setUsers(r.users));
  useEffect(() => { load(); }, []);
  const patch = async (id: string, body: object) => {
    setErr(null);
    try { await api(`/api/admin/users/${id}`, { method: "PATCH", json: body }); setEdit(null); load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "Erro"); }
  };
  return (
    <div className="card overflow-hidden">
      {err && <p className="bg-danger-soft px-5 py-2 text-sm text-danger">{err}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
            <tr><th className="px-5 py-3 font-medium">Pessoa</th><th className="px-3 py-3 font-medium">Arquivos</th><th className="px-3 py-3 font-medium">Volume</th><th className="px-3 py-3 font-medium">Último acesso</th><th className="px-3 py-3" /></tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="border-b border-line/50 last:border-0">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar id={u.id} name={u.displayName} size={32} />
                    <div className="min-w-0">
                      {edit === u.id ? (
                        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); patch(u.id, { displayName: name }); }}>
                          <input className="input h-9 text-sm" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                          <button className="btn-primary btn-sm">Salvar</button>
                          <button type="button" className="btn-ghost btn-sm" onClick={() => setEdit(null)}>×</button>
                        </form>
                      ) : (
                        <p className="font-medium">{u.displayName} {u.role === "ADMIN" && <Badge tone="amber">admin</Badge>} {u.status === "DISABLED" && <Badge tone="danger">desativado</Badge>}</p>
                      )}
                      <p className="text-xs text-muted">{u.email} · desde {fmtDateTime(u.createdAt)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 tabular-nums">{u.active}{u.deleted ? <span className="text-muted"> (+{u.deleted} excl.)</span> : ""}</td>
                <td className="px-3 py-3 tabular-nums">{fmtBytes(u.bytes)}</td>
                <td className="px-3 py-3 text-muted">{u.lastSeen ? fmtDateTime(u.lastSeen) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  <button className="rounded-full px-3 py-1 text-xs text-muted hover:bg-ivory-deep hover:text-ink" onClick={() => { setEdit(u.id); setName(u.displayName); }}>Renomear</button>
                  {u.role === "USER" && (
                    <button className="rounded-full px-3 py-1 text-xs text-muted hover:bg-ivory-deep hover:text-ink" onClick={() => patch(u.id, { status: u.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}>
                      {u.status === "ACTIVE" ? "Desativar" : "Reativar"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!users && <div className="skeleton m-5 h-40 rounded-xl" />}
    </div>
  );
}
