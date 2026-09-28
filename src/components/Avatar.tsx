import { initials, personColor } from "@/lib/format";
export function Avatar({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  return (
    <span aria-hidden className="inline-grid shrink-0 place-items-center rounded-full font-medium text-white ring-2 ring-card"
      style={{ width: size, height: size, background: personColor(id), fontSize: size * 0.38 }}>{initials(name)}</span>
  );
}
