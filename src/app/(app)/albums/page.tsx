"use client";
import Link from "next/link";
import { PageHeader } from "@/components/AppShell";
import { useAlbums } from "@/components/PeopleBar";
import { Avatar } from "@/components/Avatar";
import { useMe } from "@/lib/me";
import { plural } from "@/lib/format";

export default function Albums() {
  const albums = useAlbums();
  const { me } = useMe();
  return (
    <>
      <PageHeader title="Álbuns" subtitle="As fotos de cada pessoa" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {(albums ?? []).map((a) => (
          <Link key={a.id} href={`/albums/${a.id}`} className="group card overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lift">
            <div className="grid aspect-[4/3] grid-cols-2 grid-rows-2 gap-0.5 bg-ivory-deep">
              {[0, 1, 2, 3].map((i) => a.previewIds[i] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={`/api/media/${a.previewIds[i]}/thumb`} alt="" loading="lazy" className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
              ) : <div key={i} className="bg-ivory-deep" />)}
            </div>
            <div className="flex items-center gap-3 p-4">
              <Avatar id={a.id} name={a.name} size={34} />
              <div className="min-w-0">
                <p className="truncate font-medium">{a.name}{a.id === me.id && <span className="text-muted font-normal"> (você)</span>} {a.disambiguator && <span className="text-xs text-muted">{a.disambiguator}</span>}</p>
                <p className="text-xs text-muted">{plural(a.photos, "foto", "fotos")} · {plural(a.videos, "vídeo", "vídeos")}</p>
              </div>
            </div>
          </Link>
        ))}
        {albums === null && Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton aspect-[4/3.8] rounded-2xl" />)}
      </div>
    </>
  );
}
