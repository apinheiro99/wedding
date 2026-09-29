"use client";
import { useEffect, useState } from "react";
type Mail = { to: string; subject: string; html: string; at: string };
export default function DevMail() {
  const [mails, setMails] = useState<Mail[]>([]);
  useEffect(() => {
    const load = () => fetch("/api/dev/mail").then((r) => r.json()).then((d) => setMails(d.mails ?? []));
    load(); const t = setInterval(load, 2000); return () => clearInterval(t);
  }, []);
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="font-serif text-3xl">Caixa de saída (dev)</h1>
      <p className="text-muted text-sm mb-6">E-mails simulados. Atualiza sozinho.</p>
      <div className="space-y-4">
        {mails.map((m, i) => (
          <details key={i} open={i === 0} className="card p-4">
            <summary className="cursor-pointer"><b>{m.subject}</b> <span className="text-muted text-sm">→ {m.to} · {new Date(m.at).toLocaleTimeString()}</span></summary>
            <iframe className="mt-3 h-96 w-full rounded-xl bg-white" sandbox="" srcDoc={m.html} title={m.subject} />
          </details>
        ))}
      </div>
    </main>
  );
}
