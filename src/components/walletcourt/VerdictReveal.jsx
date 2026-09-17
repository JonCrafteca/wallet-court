import VerdictStamp from "./VerdictStamp";
import SeverityMeter from "./SeverityMeter";
import EvidenceFolder from "./EvidenceFolder";
import ShareBar from "./ShareBar";
import ShoutItGallery from "./ShoutItGallery";

export default function VerdictReveal({ trial, onReset }) {
  const addr = trial.normalized_wallet_address || "";
  const isOnePump = trial.verdict_code === "one_pump_chump";
  const isLive = trial.data_mode === "live";

  return (
    <section className="mx-auto max-w-5xl px-4 pt-6 sm:pt-10 pb-20">
      {/* Mobile sticky verdict banner */}
      <div className="lg:hidden sticky top-[7.5rem] z-20 -mx-4 px-4 py-2 bg-court-navy border-y-2 border-court-ice mb-4">
        <span className="font-display uppercase text-court-ice text-base tracking-[0.06em]">
          {trial.verdict_name}
        </span>
        <span className="float-right font-mono text-[0.55rem] uppercase tracking-[0.15em] text-court-chart mt-1">
          {isLive ? "Live · Nansen" : "Demo Mode"}
        </span>
      </div>

      {/* Verdict broadcast panel */}
      <div className="border-4 border-court-ice bg-court-navy shadow-[10px_10px_0_0_#5127C7]">
        {/* Case header strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-court-ice bg-court-cobalt px-4 py-2">
          <div className="flex items-center gap-3 font-mono text-[0.6rem] uppercase tracking-[0.14em]">
            <span className="text-court-chart font-bold">Case No. {trial.public_slug?.slice(-8).toUpperCase()}</span>
            <span className="text-court-ice">{trial.network}</span>
            <span className="text-court-ice truncate">{addr.slice(0, 8)}…{addr.slice(-6)}</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-[0.58rem] uppercase tracking-[0.14em]">
            <span className={isLive ? "text-court-chart" : "text-court-red"}>
              {isLive ? "Live · Nansen Evidence" : "Demo Mode"}
            </span>
            <span className="text-court-ice">Powered by Nansen API</span>
          </div>
        </div>

        <div className="p-5 sm:p-8">
          <VerdictStamp trial={trial} />

          {/* One Pump Chump chartreuse strip */}
          {isOnePump && (
            <div className="mt-6 bg-court-chart border-y-4 border-court-navy px-4 py-3 text-center shadow-[0_4px_0_0_#10142A]">
              <span className="font-display uppercase tracking-[0.08em] text-court-navy text-lg sm:text-2xl">
                Performance Review: Arrived Early. Finished Earlier.
              </span>
            </div>
          )}

          {/* Body grid */}
          <div className="mt-7 grid lg:grid-cols-[3fr_2fr] gap-6">
            {/* Left: roast, defense, sentence */}
            <div className="space-y-5">
              <div className="border-2 border-court-ice bg-court-ice p-5 shadow-[5px_5px_0_0_#5127C7]">
                <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-court-red mb-2">
                  The Roast · For the Record
                </p>
                <p className="font-mono text-court-navy leading-relaxed text-[0.92rem]">
                  {trial.roast}
                </p>
              </div>

              <div className="border-l-4 border-court-red pl-4 py-1">
                <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-court-mute mb-1">
                  Defense entered
                </p>
                <p className="font-mono italic text-court-mute text-sm leading-relaxed">
                  “{trial.defense_statement}”
                </p>
              </div>

              <div className="border-2 border-court-chart bg-court-navy p-5 shadow-[5px_5px_0_0_#D8FF32]">
                <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-court-chart mb-2">
                  The Sentence
                </p>
                <p className="font-display uppercase text-court-ice leading-tight text-lg">
                  {trial.sentence}
                </p>
              </div>
            </div>

            {/* Right: meters, exhibits, share */}
            <div className="space-y-5">
              <SeverityMeter severity={trial.severity_score} confidence={trial.confidence_score} />
              <EvidenceFolder trial={trial} />
              <ShareBar slug={trial.public_slug} onReset={onReset} />
            </div>
          </div>
        </div>
      </div>

      {/* ShoutIt Public Gallery — below the verdict */}
      <ShoutItGallery />
    </section>
  );
}