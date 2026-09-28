"use client";
import { useState } from "react";
import Link from "next/link";
import { api, ApiError } from "@/lib/api";
import { AuthShell, ErrorNote, Spinner } from "@/components/auth";
import { VerifyStep } from "@/components/VerifyStep";

export default function Login() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = () => api("/api/auth/login", { method: "POST", json: { email } }).then(() => {});

  if (sent) return (
    <AuthShell title="Confira seu e-mail" step="Já tenho acesso">
      <VerifyStep email={email} onResend={send} onBack={() => setSent(false)} />
    </AuthShell>
  );
  return (
    <AuthShell title="Bem-vindo de volta" subtitle="Informe seu e-mail e enviaremos um código de acesso." step="Já tenho acesso">
      <form onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { await send(); setSent(true); } catch (e) { setErr(e instanceof ApiError ? e.message : "Falha de conexão."); } finally { setBusy(false); }
      }}>
        <label className="label" htmlFor="email">Seu e-mail</label>
        <input id="email" className="input" type="email" autoComplete="email" required autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" />
        <ErrorNote msg={err} />
        <button className="btn-primary w-full mt-6 h-12" disabled={busy}>{busy ? <Spinner /> : "Enviar código"}</button>
      </form>
      <p className="mt-8 text-center text-sm text-muted">
        Primeira vez aqui? <Link href="/onboarding" className="font-medium text-terra hover:text-terra-dark">Primeiro acesso</Link>
      </p>
    </AuthShell>
  );
}
