"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/me";
import { PageHeader } from "@/components/AppShell";
import { ErrorNote } from "@/components/auth";
import { Avatar, reloadAvatars } from "@/components/Avatar";

export default function Account() {
  const { me, reload } = useMe();
  const router = useRouter();
  const [name, setName] = useState(me.displayName);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Conta" subtitle={me.email} />
      <div className="grid gap-6 md:grid-cols-2 max-w-4xl">
        <PhotoCard id={me.id} name={me.displayName} />
        <form className="card p-6" onSubmit={async (e) => {
          e.preventDefault(); setErr(null); setSaved(false);
          try { await api("/api/me", { method: "PATCH", json: { displayName: name } }); setSaved(true); reload(); }
          catch (e) { setErr(e instanceof ApiError ? e.message : "Falha de conexão."); }
        }}>
          <h2 className="font-medium">Seu nome</h2>
          <p className="text-sm text-muted mt-1 mb-4">É assim que a família vê quem enviou cada foto.</p>
          <input className="input" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setSaved(false); }} aria-label="Nome de exibição" />
          <ErrorNote msg={err} />
          <div className="mt-4 flex items-center gap-3">
            <button className="btn-primary btn-sm" disabled={name.trim() === me.displayName || !name.trim()}>Salvar</button>
            {saved && <span className="text-sm text-sage">✓ Salvo</span>}
          </div>
        </form>
        <div className="card p-6">
          <h2 className="font-medium">Sessão</h2>
          <p className="text-sm text-muted mt-1 mb-4">Você fica conectado neste aparelho por 30 dias.</p>
          <button className="btn-ghost btn-sm" onClick={async () => {
            await api("/api/auth/logout", { method: "POST" });
            if (me.isAdmin) await api("/api/admin/auth/logout", { method: "POST" });
            router.replace("/");
          }}>Sair deste aparelho</button>
        </div>
      </div>
    </>
  );
}

function PhotoCard({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function upload(f: File) {
    setBusy(true); setErr(null);
    const fd = new FormData(); fd.append("file", f);
    const r = await fetch("/api/me/avatar", { method: "POST", body: fd, headers: { "x-requested-with": "fetch" } });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).message ?? "Falha ao enviar.");
    reloadAvatars(); setBusy(false);
  }
  return (
    <div className="card flex items-center gap-5 p-6 md:col-span-2">
      <div className={busy ? "animate-pulse" : ""}><Avatar id={id} name={name} size={88} /></div>
      <div className="min-w-0">
        <h2 className="font-medium">Sua foto</h2>
        <p className="mt-1 text-sm text-muted">Opcional. Aparece ao lado das fotos que você enviar.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="btn-primary btn-sm cursor-pointer">
            {busy ? "Enviando…" : "Escolher foto"}
            <input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
          </label>
          <button className="btn-ghost btn-sm" onClick={async () => { await fetch("/api/me/avatar", { method: "DELETE", headers: { "x-requested-with": "fetch" } }); reloadAvatars(); }}>Remover</button>
        </div>
        <ErrorNote msg={err} />
      </div>
    </div>
  );
}
