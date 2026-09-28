"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function Admin() {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  useEffect(() => { api("/api/admin/ping").then(() => setOk(true)).catch(() => router.replace("/admin/login")); }, [router]);
  if (!ok) return null;
  return (
    <main className="mx-auto max-w-5xl p-6 md:p-10">
      <p className="text-[12px] uppercase tracking-[0.2em] text-amber">Administração</p>
      <h1 className="font-serif text-4xl mt-2">Painel</h1>
      <p className="text-muted mt-2">Usuários, mídias, jobs e ZIPs chegam aqui nas próximas etapas.</p>
      <Link href="/photos" className="btn-primary mt-8">Abrir o site como usuário →</Link>
    </main>
  );
}
