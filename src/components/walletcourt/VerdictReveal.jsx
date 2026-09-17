import VerdictStamp from "./VerdictStamp";
import SeverityMeter from "./SeverityMeter";
import EvidenceFolder from "./EvidenceFolder";
import ShareBar from "./ShareBar";

export default function VerdictReveal({ trial, onReset }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-6 sm:pt-10 pb-24">
      {/* Mobile sticky verdict banner */}
      <div className="lg:hidden sticky top-12 z-20 -mx-4 px-4 py-2 bg-court-bg/90 backdrop-blur border-b border-court-line mb-4">
        <span className="font-display font-bold uppercase text-court-gold text-sm tracking-[0.1em]">
          {trial.verdict_name}
        </span>
        <span className="float-right text-[0.6rem] uppercase tracking-[0.15em] text-muted-foreground mt-1">
          {trial.data_mode === "live" ? "Live · Nansen" : "Demo Mode"}
        </span>
      </div>

      <div className="grid lg:grid-cols-[3fr_2fr] gap-6">
        {/* Left stage */}
        <div className="space-y-5">
          <VerdictStamp trial={trial} />
          <SeverityMeter severity={trial.severity_score} confidence={trial.confidence_score} />

          <div className="border border-court-line bg-court-surface p-5">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-court-gold mb-2">
              The Roast · For the Record
            </p>
            <p className="font-body text-court-text/90 leading-relaxed text-[0.95rem]">
              {trial.roast}
            </p>
          </div>

          <div className="border-l-2 border-court-line pl-4 py-1">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground mb-1">
              Defense entered
            </p>
            <p className="font-body italic text-muted-foreground text-sm leading-relaxed">
              “{trial.defense_statement}”
            </p>
          </div>

          <div className="border-2 border-court-gold/60 bg-court-gold/5 p-5">
            <p className="text-[0.6rem] uppercase tracking-[0.2em] text-court-gold mb-2">
              The Sentence
            </p>
            <p className="font-display font-bold uppercase text-court-text leading-snug text-base">
              {trial.sentence}
            </p>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-5">
          <div className="flex items-center justify-between text-[0.6rem] uppercase tracking-[0.18em]">
            <span className="text-muted-foreground">
              {trial.network} · {trial.normalized_wallet_address?.slice(0, 8)}…{trial.normalized_wallet_address?.slice(-6)}
            </span>
            <span className={trial.data_mode === "live" ? "text-court-green" : "text-court-gold"}>
              {trial.data_mode === "live" ? "Live · Nansen" : "Demo Mode"}
            </span>
          </div>

          <EvidenceFolder trial={trial} />

          <ShareBar slug={trial.public_slug} onReset={onReset} />
        </div>
      </div>
    </section>
  );
}