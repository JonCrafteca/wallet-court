import { ShieldCheck } from "lucide-react";

export default function TopRail() {
  return (
    <header className="sticky top-0 z-30 border-b border-court-line bg-court-bg/85 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 h-12 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-display font-bold text-court-gold text-sm sm:text-base tracking-[0.18em] truncate">
            WALLETVOURT
          </span>
          <span className="hidden sm:inline text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground border-l border-court-line pl-2">
            // Nansen Evidence Division
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 border border-court-line bg-court-surface px-2 py-1 text-[0.6rem] uppercase tracking-[0.18em] text-court-gold">
            <span className="h-1.5 w-1.5 rounded-full bg-court-gold animate-blink" />
            Demo Mode
          </span>
          <span className="hidden sm:inline-flex items-center gap-1 text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-court-green" />
            No wallet connect
          </span>
        </div>
      </div>
    </header>
  );
}