"use client";
import { use, useState } from "react";
import { Gallery } from "@/components/Gallery";
import { PageHeader } from "@/components/AppShell";
import { OrderToggle, PeopleChips, useAlbums } from "@/components/PeopleBar";
import { Avatar } from "@/components/Avatar";
import { useMe } from "@/lib/me";
import { plural } from "@/lib/format";

export default function Album({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const albums = useAlbums();
  const { me } = useMe();
  const a = albums?.find((x) => x.id === userId);
  return (
    <>
      <PageHeader
        title={a ? `${a.name}${a.id === me.id ? " (você)" : ""}` : "Álbum"}
        subtitle={a ? <span className="inline-flex items-center gap-2"><Avatar id={a.id} name={a.name} size={20} />{plural(a.photos, "foto", "fotos")} · {plural(a.videos, "vídeo", "vídeos")}</span> : " "}
        actions={<OrderToggle order={order} onChange={setOrder} />} />
      {albums && <PeopleChips albums={albums} active={userId} />}
      <Gallery uploader={userId} order={order} />
    </>
  );
}
