export default function TopRail() {
  return (
    <header className="sticky top-0 z-30 bg-court-ink text-court-bg border-b-2 border-court-ink">
      <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3 min-w-0">
          <span className="font-display font-black uppercase tracking-[0.14em] text-court-bg text-base sm:text-lg">
            Wallet Court
          </span>
          <span className="hidden sm:inline text-[0.58rem] uppercase tracking-[0.22em] text-court-fade border-l border-court-fade pl-3">
            Nansen Evidence Division
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="inline-flex items-center gap-1.5 border border-court-fade px-2 py-1 text-[0.58rem] uppercase tracking-[0.18em] text-court-bg">
            <span className="h-1.5 w-1.5 rounded-full bg-court-green animate-blink" />
            Demo Mode
          </span>
          <span className="hidden sm:inline text-[0.58rem] uppercase tracking-[0.18em] text-court-fade">
            A ShoutIt Experiment
          </span>
        </div>
      </div>
    </header>
  );
}