"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import { ErrorNote, OtpInput, Spinner } from "./auth";

export function VerifyStep({ email, onResend, onBack }: { email: string; onResend: () => Promise<void>; onBack: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const [resent, setResent] = useState(false);

  async function verify(code: string) {
    setBusy(true); setErr(null);
    try {
      await api("/api/auth/verify", { method: "POST", json: { email, code } });
      router.replace("/photos");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Falha de conexão.");
      setKey((k) => k + 1);
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-4 text-muted">Enviamos um código de 6 dígitos para <b className="text-ink">{email}</b>.</p>
      <p role="note" className="mb-6 flex items-start gap-2 rounded-xl bg-amber-soft px-4 py-3 text-sm text-ink">
        <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-amber" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 6h16v12H4z M4 7l8 6 8-6" /></svg>
        <span>Não chegou? Olhe também a caixa de <b>spam</b> ou <b>lixo eletrônico</b>. Pode levar até 1 minuto.</span>
      </p>
      <OtpInput key={key} onComplete={verify} disabled={busy} />
      {busy && <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Spinner /> Verificando…</p>}
      <ErrorNote msg={err} />
      <div className="mt-8 flex items-center justify-between text-sm">
        <button type="button" onClick={onBack} className="text-muted hover:text-ink">Trocar e-mail</button>
        <button type="button" disabled={resent}
          onClick={async () => { setErr(null); try { await onResend(); setResent(true); setKey((k) => k + 1); setTimeout(() => setResent(false), 30000); } catch (e) { setErr((e as Error).message); } }}
          className="font-medium text-terra hover:text-terra-dark disabled:text-muted">
          {resent ? "Código reenviado" : "Reenviar código"}
        </button>
      </div>
    </div>
  );
}
