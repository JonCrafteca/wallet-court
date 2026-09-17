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
      <div className="lg:hidden sticky top-14 z-20 -mx-4 px-4 py-2 bg-court-ink text-court-bg border-b-2 border-court-ink mb-4">
        <span className="font-display font-bold uppercase text-court-bg text-sm tracking-[0.1em]">
          {trial.verdict_name}
        </span>
        <span className="float-right font-mono text-[0.55rem] uppercase tracking-[0.15em] text-court-fade mt-1">
          {isLive ? "Live · Nansen" : "Demo Mode"}
        </span>
      </div>

      {/* Case folder */}
      <div className="relative">
        <div className="flex">
          <div className="bg-court-folder border-2 border-b-0 border-court-ink px-4 py-1.5 -mb-px relative z-10">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-court-ink">
              Verdict · Delivered
            </span>
          </div>
        </div>

        <div className="border-2 border-court-ink bg-court-folder">
          <div className="m-1 border border-court-ink/30 bg-court-paper">
            {/* Case header strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-court-ink px-4 py-2 bg-court-paper">
              <div className="flex items-center gap-3 font-mono text-[0.6rem] uppercase tracking-[0.14em]">
                <span className="text-court-ink font-bold">Case No. {trial.public_slug?.slice(-8).toUpperCase()}</span>
                <span className="text-court-gray">{trial.network}</span>
                <span className="text-court-gray truncate">{addr.slice(0, 8)}…{addr.slice(-6)}</span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[0.58rem] uppercase tracking-[0.14em]">
                <span className={isLive ? "text-court-green" : "text-court-red"}>
                  {isLive ? "Live · Nansen Evidence" : "Demo Mode"}
                </span>
                <span className="text-court-gray">Powered by Nansen API</span>
              </div>
            </div>

            <div className="p-5 sm:p-8">
              {/* Stamp + oversized verdict name */}
              <VerdictStamp trial={trial} />

              {/* One Pump Chump fluorescent strip */}
              {isOnePump && (
                <div className="mt-6 bg-court-green border-y-2 border-court-ink px-4 py-2.5 text-center">
                  <span className="font-mono font-bold uppercase tracking-[0.12em] text-court-ink text-sm sm:text-base">
                    Performance Review: Arrived Early. Finished Earlier.
                  </span>
                </div>
              )}

              {/* Body grid */}
              <div className="mt-7 grid lg:grid-cols-[3fr_2fr] gap-6">
                {/* Left: roast, defense, sentence */}
                <div className="space-y-5">
                  <div className="border-2 border-court-ink bg-court-paper p-5">
                    <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-court-red mb-2">
                      The Roast · For the Record
                    </p>
                    <p className="font-body text-court-ink leading-relaxed text-[0.92rem]">
                      {trial.roast}
                    </p>
                  </div>

                  <div className="border-l-4 border-court-red pl-4 py-1">
                    <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-court-gray mb-1">
                      Defense entered
                    </p>
                    <p className="font-body italic text-court-gray text-sm leading-relaxed">
                      “{trial.defense_statement}”
                    </p>
                  </div>

                  <div className="border-2 border-court-ink bg-court-ink text-court-bg p-5">
                    <p className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-court-green mb-2">
                      The Sentence
                    </p>
                    <p className="font-display font-bold uppercase text-court-bg leading-snug text-base">
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
        </div>
      </div>

      {/* ShoutIt Public Gallery — below the verdict */}
      <ShoutItGallery />
    </section>
  );
}