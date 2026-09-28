"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { AuthShell, ErrorNote, Spinner } from "@/components/auth";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <AuthShell title="Administração" subtitle="Acesso restrito." step="Admin">
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { await api("/api/admin/auth/login", { method: "POST", json: { email, password } }); router.replace("/admin"); }
        catch (e) { setErr(e instanceof ApiError ? e.message : "Falha de conexão."); setBusy(false); }
      }}>
        <label className="label" htmlFor="ae">E-mail administrativo</label>
        <input id="ae" className="input" type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="label mt-4" htmlFor="ap">Senha</label>
        <input id="ap" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorNote msg={err} />
        <button className="btn-primary w-full mt-6 h-12" disabled={busy}>{busy ? <Spinner /> : "Entrar"}</button>
      </form>
    </AuthShell>
  );
}
