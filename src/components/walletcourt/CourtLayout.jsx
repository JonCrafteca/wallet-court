import { Outlet } from "react-router-dom";
import TopRail from "./TopRail";

export default function CourtLayout() {
  return (
    <div className="min-h-screen bg-court-bg text-court-ink font-body relative overflow-x-hidden">
      <div className="fixed inset-0 paper-grain opacity-60 pointer-events-none" aria-hidden />
      <div className="fixed inset-0 paper-vignette pointer-events-none" aria-hidden />
      <div className="relative z-10 flex min-h-screen flex-col">
        <TopRail />
        <main className="flex-1">
          <Outlet />
        </main>
        <footer className="border-t-2 border-court-ink bg-court-paper px-4 py-4">
          <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-2 text-[0.62rem] uppercase tracking-[0.15em] text-court-gray">
            <span>Wallet Court // Nansen Evidence Division · A ShoutIt Experiment</span>
            <span className="text-court-ink">Powered by Nansen API</span>
            <span className="w-full sm:w-auto sm:text-right">Verdicts are parody. Not financial advice. Roasts target behavior, never identity.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}