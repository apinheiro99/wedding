"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { useMe } from "@/lib/me";
import { PageHeader } from "@/components/AppShell";
import { ErrorNote } from "@/components/auth";

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
