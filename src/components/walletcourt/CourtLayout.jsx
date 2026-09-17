import { Outlet } from "react-router-dom";
import TopRail from "./TopRail";

export default function CourtLayout() {
  return (
    <div className="min-h-screen bg-court-bg text-court-text font-body relative overflow-x-hidden">
      <div className="fixed inset-0 court-grid-bg pointer-events-none" aria-hidden />
      <div className="fixed inset-0 court-scanlines pointer-events-none" aria-hidden />
      <div className="relative z-10 flex min-h-screen flex-col">
        <TopRail />
        <main className="flex-1">
          <Outlet />
        </main>
        <footer className="border-t border-court-line px-4 py-3 text-[0.65rem] uppercase tracking-[0.15em] text-muted-foreground">
          <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-2">
            <span>Wallet Court // Nansen Evidence Division</span>
            <span>Verdicts are parody. Not financial advice. Roasts target behavior, never identity.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}