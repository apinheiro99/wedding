"use client";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { AuthShell, ErrorNote, Spinner } from "@/components/auth";
import { VerifyStep } from "@/components/VerifyStep";

type Step = "family" | "profile" | "verify";

export default function Onboarding() {
  const [step, setStep] = useState<Step>("family");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : "Falha de conexão."); } finally { setBusy(false); }
  }
  const signup = () => api("/api/auth/signup", { method: "POST", json: { displayName: name, email } }).then(() => {});
  const dots = (n: number) => (
    <div className="mb-8 flex gap-1.5" aria-hidden>
      {[0, 1, 2].map((i) => <span key={i} className={`h-1 rounded-full transition-all ${i <= n ? "w-8 bg-terra" : "w-4 bg-line"}`} />)}
    </div>
  );

  if (step === "family") return (
    <AuthShell title="Acesso da família" subtitle="Use o usuário e a senha que a família compartilhou com você." step="Primeiro acesso · 1 de 3">
      {dots(0)}
      <form onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/api/auth/family", { method: "POST", json: { login, password } }); setStep("profile"); }); }}>
        <label className="label" htmlFor="fl">Usuário da família</label>
        <input id="fl" className="input" autoComplete="username" required autoFocus value={login} onChange={(e) => setLogin(e.target.value)} />
        <label className="label mt-4" htmlFor="fp">Senha da família</label>
        <input id="fp" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <ErrorNote msg={err} />
        <button className="btn-primary w-full mt-6 h-12" disabled={busy}>{busy ? <Spinner /> : "Continuar"}</button>
      </form>
    </AuthShell>
  );
  if (step === "profile") return (
    <AuthShell title="Quem é você?" subtitle="Seu nome aparece nas fotos que você enviar. O e-mail é o seu acesso pessoal." step="Primeiro acesso · 2 de 3">
      {dots(1)}
      <form onSubmit={(e) => { e.preventDefault(); run(async () => { await signup(); setStep("verify"); }); }}>
        <label className="label" htmlFor="nm">Seu nome</label>
        <input id="nm" className="input" autoComplete="name" required maxLength={60} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Como a família te chama" />
        <label className="label mt-4" htmlFor="em">Seu e-mail pessoal</label>
        <input id="em" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" />
        <ErrorNote msg={err} />
        <button className="btn-primary w-full mt-6 h-12" disabled={busy}>{busy ? <Spinner /> : "Enviar código"}</button>
      </form>
    </AuthShell>
  );
  return (
    <AuthShell title="Confira seu e-mail" step="Primeiro acesso · 3 de 3">
      {dots(2)}
      <VerifyStep email={email} onResend={signup} onBack={() => setStep("profile")} />
    </AuthShell>
  );
}
