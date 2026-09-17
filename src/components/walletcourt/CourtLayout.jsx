import { Outlet } from "react-router-dom";
import TickerTape from "./TickerTape";

export default function CourtLayout() {
  return (
    <div className="min-h-screen bg-court-cobalt text-court-ice font-body relative overflow-x-hidden">
      <div className="fixed inset-0 broadcast-grid pointer-events-none" aria-hidden />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 bg-court-cobalt border-b-4 border-court-navy">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="font-display uppercase tracking-[0.04em] text-court-ice text-xl sm:text-2xl leading-none">
                Wallet Court
              </span>
              <span className="hidden sm:inline font-mono text-[0.58rem] uppercase tracking-[0.22em] text-court-mute border-l border-court-mute pl-3">
                Nansen Evidence Division
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="inline-flex items-center gap-1.5 border-2 border-court-chart bg-court-navy px-2 py-1 text-[0.58rem] uppercase tracking-[0.18em] text-court-chart">
                <span className="h-1.5 w-1.5 rounded-full bg-court-chart animate-blink" />
                Demo Mode
              </span>
              <span className="hidden sm:inline font-mono text-[0.58rem] uppercase tracking-[0.18em] text-court-mute">
                A ShoutIt Experiment
              </span>
            </div>
          </div>
          <TickerTape />
        </header>

        <main className="flex-1">
          <Outlet />
        </main>

        <footer className="border-t-4 border-court-navy bg-court-navy px-4 py-4">
          <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-2 font-mono text-[0.6rem] uppercase tracking-[0.15em] text-court-mute">
            <span>Wallet Court // Nansen Evidence Division · A ShoutIt Experiment</span>
            <span className="text-court-chart">Powered by Nansen API</span>
            <span className="w-full sm:w-auto sm:text-right">Verdicts are parody. Not financial advice. Roasts target behavior, never identity.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}