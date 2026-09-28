"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useMe } from "@/lib/me";
import { Avatar } from "./Avatar";

export type Album = { id: string; name: string; total: number; photos: number; videos: number; coverId: string | null; previewIds: string[]; disambiguator: string | null };

export function useAlbums() {
  const [albums, setAlbums] = useState<Album[] | null>(null);
  useEffect(() => { api<{ albums: Album[] }>("/api/albums").then((r) => setAlbums(r.albums)).catch(() => setAlbums([])); }, []);
  return albums;
}

export function OrderToggle({ order, onChange }: { order: "asc" | "desc"; onChange: (o: "asc" | "desc") => void }) {
  return (
    <div role="group" aria-label="Ordenar" className="inline-flex rounded-full border border-line bg-card p-1 text-sm shadow-soft">
      {(["desc", "asc"] as const).map((o) => (
        <button key={o} onClick={() => onChange(o)} aria-pressed={order === o}
          className={`rounded-full px-3.5 py-1.5 transition ${order === o ? "bg-ink text-ivory" : "text-muted hover:text-ink"}`}>
          {o === "desc" ? "Mais novas" : "Mais antigas"}
        </button>
      ))}
    </div>
  );
}

export function PeopleChips({ albums, active }: { albums: Album[]; active?: string | null }) {
  const { me } = useMe();
  return (
    <nav aria-label="Filtrar por pessoa" className="-mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1 md:-mx-0 md:flex-wrap md:px-0 [scrollbar-width:none]">
      <Link href="/photos" className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition ${!active ? "border-ink bg-ink text-ivory" : "border-line bg-card hover:border-ink/30"}`}>Todo mundo</Link>
      {albums.map((a) => (
        <Link key={a.id} href={`/albums/${a.id}`} aria-current={active === a.id ? "page" : undefined}
          className={`flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm transition ${active === a.id ? "border-ink bg-ink text-ivory" : "border-line bg-card hover:border-ink/30"}`}>
          <Avatar id={a.id} name={a.name} size={24} />
          <span>{a.name}{a.id === me.id && <span className="opacity-60"> (você)</span>}</span>
          {a.disambiguator && <span className="text-xs opacity-50">{a.disambiguator}</span>}
          <span className={`text-xs tabular-nums ${active === a.id ? "text-ivory/60" : "text-muted"}`}>{a.total}</span>
        </Link>
      ))}
    </nav>
  );
}
