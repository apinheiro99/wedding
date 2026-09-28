"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

export default function Settings() {
  const [s, setS] = useState<{ notificationsEnabled: boolean; eventTitle: string; familyLogin: string } | null>(null);
  const [title, setTitle] = useState("");
  const [login, setLogin] = useState("");
  const [pwd, setPwd] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { api<{ settings: NonNullable<typeof s> }>("/api/admin/overview").then((o) => { setS(o.settings); setTitle(o.settings.eventTitle); setLogin(o.settings.familyLogin); }); }, []);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setMsg(null); try { await fn(); setMsg(ok); } catch (e) { setMsg(e instanceof ApiError ? e.message : "Erro"); } };
  if (!s) return <div className="skeleton h-64 rounded-2xl" />;
  return (
    <div className="grid max-w-4xl gap-4 md:grid-cols-2">
      {msg && <p className="rounded-xl bg-sage-soft px-4 py-2 text-sm text-sage md:col-span-2" role="status">{msg}</p>}
      <div className="card p-6">
        <h2 className="font-medium">Notificações de novas fotos</h2>
        <p className="mt-1 text-sm text-muted">Resumo por e-mail após 15 minutos sem novos envios.</p>
        <label className="mt-4 flex cursor-pointer items-center gap-3">
          <button role="switch" aria-checked={s.notificationsEnabled} onClick={() => run(async () => { await api("/api/admin/settings", { method: "PATCH", json: { notificationsEnabled: !s.notificationsEnabled } }); setS({ ...s, notificationsEnabled: !s.notificationsEnabled }); }, "Preferência salva.")}
            className={`relative h-7 w-12 rounded-full transition ${s.notificationsEnabled ? "bg-sage" : "bg-line"}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${s.notificationsEnabled ? "left-6" : "left-1"}`} />
          </button>
          <span className="text-sm">{s.notificationsEnabled ? "Ligadas" : "Desligadas"}</span>
        </label>
      </div>
      <form className="card p-6" onSubmit={(e) => { e.preventDefault(); run(() => api("/api/admin/settings", { method: "PATCH", json: { eventTitle: title } }), "Título salvo."); }}>
        <h2 className="font-medium">Título do evento</h2>
        <p className="mt-1 text-sm text-muted">Aparece na página inicial.</p>
        <input className="input mt-4" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        <button className="btn-primary btn-sm mt-3">Salvar</button>
      </form>
      <form className="card p-6 md:col-span-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/api/admin/family-credential", { method: "POST", json: { login, password: pwd } }); setPwd(""); }, "Credencial da família alterada."); }}>
        <h2 className="font-medium">Credencial compartilhada da família</h2>
        <p className="mt-1 text-sm text-muted">Usada só no primeiro acesso de cada pessoa. Quem já tem acesso não é afetado.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div><label className="label" htmlFor="fl">Usuário</label><input id="fl" className="input" value={login} onChange={(e) => setLogin(e.target.value)} required /></div>
          <div><label className="label" htmlFor="fp">Nova senha</label><input id="fp" className="input" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} minLength={6} required autoComplete="new-password" /></div>
        </div>
        <button className="btn-primary btn-sm mt-4">Alterar credencial</button>
      </form>
    </div>
  );
}
