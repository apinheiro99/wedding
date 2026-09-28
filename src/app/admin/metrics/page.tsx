"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtBytes, fmtDuration } from "@/lib/format";
import { Avatar } from "@/components/Avatar";
import { BarList, Card, Columns, Donut, Kpi, Meter } from "@/components/charts";

type M = {
  tz: string;
  kpis: {
    total: number; photos: number; videos: number; others: number; bytes: number; people: number; videoMs: number;
    firstCapture: string | null; lastCapture: string | null; withGps: number; withCameraDate: number; users: number; newUsers7d: number;
    duplicates: number; duplicateBytes: number; restored: number; downloads: number; downloadBytes: number; downloaders: number;
    thumbsBytes: number; packagesBytes: number; disk: { free: number; total: number } | null;
  };
  byPerson: { id: string; name: string; total: number; photos: number; videos: number; bytes: number }[];
  byFormat: { ext: string; n: number; bytes: number }[];
  byHour: number[];
  byCaptureDay: { d: string; n: number }[];
  uploadsPerDay: { d: string; n: number; bytes: number }[];
  downloadsPerDay: { d: string; n: number }[];
  cameras: { cam: string; n: number }[];
  sizes: number[];
  resolution: { r: string; n: number }[];
  topDownloaded: { name: string; label: string; n: number }[];
};

const SIZE_LABELS = ["< 1 MB", "1–5 MB", "5–20 MB", "20–100 MB", "100 MB–1 GB", "> 1 GB"];
const n = (x: number) => x.toLocaleString("pt-BR");
const day = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const longDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

export default function Metrics() {
  const [m, setM] = useState<M | null>(null);
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const load = () => api<M>(`/api/admin/metrics?tz=${encodeURIComponent(tz)}`).then(setM).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  if (!m) return <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}</div>;
  const k = m.kpis;
  const formats = m.byFormat.slice(0, 4).map((f) => ({ label: f.ext, value: f.n }));
  const restFormats = m.byFormat.slice(4).reduce((a, f) => a + f.n, 0);
  if (restFormats) formats.push({ label: "Outros", value: restFormats });
  const peakHour = m.byHour.indexOf(Math.max(...m.byHour));
  const storageUsed = k.bytes + k.thumbsBytes + k.packagesBytes;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl tracking-tight md:text-4xl">Métricas do álbum</h1>
          <p className="mt-1 text-sm text-muted">Atualiza a cada 30 s · horários em {m.tz.replace("_", " ")}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi accent label="Mídias no álbum" value={n(k.total)} hint={`${n(k.photos)} fotos · ${n(k.videos)} vídeos${k.others ? ` · ${n(k.others)} outros` : ""}`} />
        <Kpi label="Volume de originais" value={fmtBytes(k.bytes)} hint={k.total ? `média ${fmtBytes(k.bytes / k.total)} por arquivo` : undefined} />
        <Kpi label="Pessoas enviando" value={n(k.people)} hint={`${n(k.users)} cadastradas · +${n(k.newUsers7d)} em 7 dias`} />
        <Kpi label="Horas de vídeo" value={k.videoMs ? fmtDuration(k.videoMs) : "0:00"} hint={`${n(k.videos)} vídeos`} />
        <Kpi label="Duplicatas evitadas" value={n(k.duplicates)} hint={`${fmtBytes(k.duplicateBytes)} economizados`} />
        <Kpi label="Restaurados" value={n(k.restored)} hint="reenvios de itens excluídos" />
        <Kpi label="Downloads" value={n(k.downloads)} hint={`${fmtBytes(k.downloadBytes)} · ${n(k.downloaders)} pessoas`} />
        <Kpi label="Com data da câmera" value={k.total ? `${Math.round((k.withCameraDate / k.total) * 100)}%` : "—"} hint={`${n(k.withGps)} com localização`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Quem mais enviou" subtitle="Arquivos por pessoa" className="lg:col-span-2">
          <BarList rows={m.byPerson.map((p) => ({ key: p.id, label: p.name, value: p.total, sub: fmtBytes(p.bytes) }))}
            lead={(id) => { const p = m.byPerson.find((x) => x.id === id)!; return <Avatar id={p.id} name={p.name} size={22} />; }} />
        </Card>
        <Card title="Fotos × vídeos" subtitle="Tipo de mídia">
          <Donut center={n(k.total)} centerLabel="arquivos"
            parts={[{ label: "Fotos", value: k.photos }, { label: "Vídeos", value: k.videos }, { label: "Outros", value: k.others }]} />
        </Card>
      </div>

      <Card title="A que horas as fotos foram tiradas" subtitle={m.byHour.some(Boolean) ? `Pico às ${String(peakHour).padStart(2, "0")}h · pela data registrada na câmera` : "Pela data registrada na câmera"}>
        <Columns values={m.byHour} labels={m.byHour.map((_, h) => `${String(h).padStart(2, "0")}h`)} every={3}
          tooltip={(i) => `${String(i).padStart(2, "0")}h–${String(i + 1).padStart(2, "0")}h · ${n(m.byHour[i]!)} fotos`} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Envios nos últimos 30 dias" subtitle="Arquivos recebidos por dia">
          <Columns values={m.uploadsPerDay.map((x) => x.n)} labels={m.uploadsPerDay.map((x) => day(x.d))} every={7}
            tooltip={(i) => `${longDay(m.uploadsPerDay[i]!.d)} · ${n(m.uploadsPerDay[i]!.n)} arquivos · ${fmtBytes(m.uploadsPerDay[i]!.bytes)}`} />
        </Card>
        <Card title="Downloads nos últimos 30 dias" subtitle="Originais e pacotes baixados por dia">
          <Columns values={m.downloadsPerDay.map((x) => x.n)} labels={m.downloadsPerDay.map((x) => day(x.d))} every={7} color="#2F7FB0"
            tooltip={(i) => `${longDay(m.downloadsPerDay[i]!.d)} · ${n(m.downloadsPerDay[i]!.n)} downloads`} />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Formatos" subtitle="Pela extensão do arquivo original">
          <Donut center={String(m.byFormat.length)} centerLabel="formatos" parts={formats} />
        </Card>
        <Card title="Câmeras e celulares" subtitle="Pelos metadados EXIF">
          <BarList rows={m.cameras.map((c) => ({ key: c.cam, label: c.cam, value: c.n }))} color="#8E5A9A" />
        </Card>
        <Card title="Dias com mais fotos" subtitle="Pela data da foto">
          <BarList rows={m.byCaptureDay.slice(0, 6).map((d) => ({ key: d.d, label: longDay(d.d), value: d.n }))} color="#3F8F5F" />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Tamanho dos arquivos">
          <Columns values={m.sizes} labels={SIZE_LABELS} height={130} color="#B07D10" tooltip={(i) => `${SIZE_LABELS[i]} · ${n(m.sizes[i]!)} arquivos`} />
        </Card>
        <Card title="Resolução das fotos">
          <Columns values={m.resolution.map((r) => r.n)} labels={m.resolution.map((r) => r.r)} height={130} color="#2F7FB0" tooltip={(i) => `${m.resolution[i]!.r} · ${n(m.resolution[i]!.n)} fotos`} />
        </Card>
        <Card title="Pacotes mais baixados">
          <BarList rows={m.topDownloaded.map((t) => ({ key: t.name + t.label, label: `${t.name} · ${t.label}`, value: t.n }))} />
        </Card>
      </div>

      <Card title="Armazenamento" subtitle="Originais, miniaturas e pacotes ZIP">
        <div className="grid gap-6 md:grid-cols-2">
          <BarList format={fmtBytes} rows={[
            { key: "o", label: "Originais", value: k.bytes },
            { key: "p", label: "Pacotes ZIP", value: k.packagesBytes },
            { key: "t", label: "Miniaturas", value: k.thumbsBytes },
          ]} />
          <div className="space-y-4">
            {k.disk && <Meter used={k.disk.total - k.disk.free} total={k.disk.total} label={`Disco: ${fmtBytes(k.disk.free)} livres de ${fmtBytes(k.disk.total)}`} />}
            <p className="text-sm text-muted">O álbum ocupa <b className="text-ink">{fmtBytes(storageUsed)}</b> no total. Pacotes ZIP e miniaturas podem ser regenerados; os originais, não.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
