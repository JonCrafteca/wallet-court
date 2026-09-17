import VerdictStamp from "./VerdictStamp";
import SeverityMeter from "./SeverityMeter";
import NansenEvidence from "./NansenEvidence";
import ActionsBar from "./ActionsBar";
import ShoutItGallery from "./ShoutItGallery";

export default function VerdictReveal({ trial, onReset }) {
  const addr = trial.normalized_wallet_address || "";
  const isOnePump = trial.verdict_code === "one_pump_chump";
  const isLive = trial.data_mode === "live";
  const shortAddr = addr ? (addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr) : "";

  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:pt-12 pb-20">
      {/* Slim case header */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-[0.14em] mb-8 border-2 border-court-ice bg-court-navy px-4 py-2">
        <span className="text-court-chart font-bold">Case No. {trial.public_slug?.slice(-8).toUpperCase()}</span>
        <span className="text-court-ice">{trial.network} · {shortAddr}</span>
        <span className={isLive ? "text-court-chart" : "text-court-red"}>
          {isLive ? "Live · Nansen" : "Demo Mode"}
        </span>
      </div>

      {/* 1. Verdict */}
      <VerdictStamp trial={trial} />
      {isOnePump && (
        <div className="mt-6 bg-court-chart border-y-4 border-court-navy px-4 py-3 text-center">
          <span className="font-display uppercase tracking-[0.06em] text-court-navy text-lg sm:text-2xl">
            Performance Review: Arrived Early. Finished Earlier.
          </span>
        </div>
      )}

      {/* Severity & confidence — secondary */}
      <div className="mt-8">
        <SeverityMeter severity={trial.severity_score} confidence={trial.confidence_score} />
      </div>

      {/* 2. Roast */}
      <div className="mt-10 border-2 border-court-ice bg-court-ice p-5 sm:p-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-court-red mb-3">The Roast · For the Record</p>
        <p className="font-mono text-court-navy leading-relaxed text-base">{trial.roast}</p>
        <div className="mt-4 border-l-4 border-court-red pl-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-court-red mb-1">Defense entered</p>
          <p className="font-mono italic text-court-navy text-sm leading-relaxed">“{trial.defense_statement}”</p>
        </div>
      </div>

      {/* 3. Nansen Evidence */}
      <div className="mt-10">
        <NansenEvidence trial={trial} />
      </div>

      {/* 4. Sentence */}
      <div className="mt-10 border-2 border-court-chart bg-court-navy p-5 sm:p-6 shadow-[5px_5px_0_0_#D8FF32]">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-court-chart mb-3">The Sentence</p>
        <p className="font-display uppercase text-court-ice leading-tight text-xl sm:text-2xl">{trial.sentence}</p>
      </div>

      {/* 5. Actions */}
      <div className="mt-10">
        <ActionsBar slug={trial.public_slug} onReset={onReset} />
      </div>

      {/* 6. ShoutIt Public Gallery */}
      <div className="mt-12">
        <ShoutItGallery />
      </div>
    </section>
  );
}