"use client";
import { useCallback, useState } from "react";
import { Gallery } from "@/components/Gallery";
import { PageHeader } from "@/components/AppShell";
import { OrderToggle, PeopleChips, useAlbums } from "@/components/PeopleBar";
import { plural } from "@/lib/format";

export default function Photos() {
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [c, setC] = useState<{ photos: number; videos: number; others: number } | null>(null);
  const albums = useAlbums();
  const onCounts = useCallback((x: typeof c | undefined) => x && setC(x), []);
  return (
    <>
      <PageHeader title="Fotos"
        subtitle={c ? <>{plural(c.photos, "foto", "fotos")} · {plural(c.videos, "vídeo", "vídeos")}{c.others ? ` · ${plural(c.others, "outro", "outros")}` : ""}</> : " "}
        actions={<OrderToggle order={order} onChange={setOrder} />} />
      {albums && albums.length > 0 && <PeopleChips albums={albums} />}
      <Gallery order={order} onCounts={onCounts} />
    </>
  );
}
