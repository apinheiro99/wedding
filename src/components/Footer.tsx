export const APP_VERSION = "v1.0.0";
export function Footer({ className = "" }: { className?: string }) {
  return (
    <footer className={`text-center text-[12px] text-muted/80 ${className}`}>
      <span className="font-medium tracking-wide">{APP_VERSION}</span>
      <span className="mx-2 opacity-50">·</span>
      feito com carinho por <span className="font-medium text-ink/70">André Pinheiro</span>
    </footer>
  );
}
