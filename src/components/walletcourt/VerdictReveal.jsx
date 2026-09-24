import VerdictStamp from "./VerdictStamp";
import SeverityMeter from "./SeverityMeter";
import NansenEvidence from "./NansenEvidence";
import ShareActions from "./ShareActions";
import ShoutItGallery from "./ShoutItGallery";
import SentenceRuling from "./SentenceRuling";
import ClaimWalletSection from "./ClaimWalletSection";
import CaseDismissed from "./CaseDismissed";
import CaseMistrial from "./CaseMistrial";
import SummonsSection from "./SummonsSection";
import CourtReceiptPreview from "./CourtReceiptPreview";
import CoverageNotice from "./CoverageNotice";
import { getCaseOutcome } from "@/lib/caseOutcome";
import { displayAddressShort } from "@/lib/wallet";

export default function VerdictReveal({ trial, onReset, subjectType, proposedHandle }) {
  // Evidence-sufficiency gate (N2.3): branch the public presentation on outcome.
  const outcome = getCaseOutcome(trial);
  if (outcome === "dismissed_no_evidence") return <CaseDismissed trial={trial} onReset={onReset} />;
  if (outcome === "mistrial_insufficient_evidence") return <CaseMistrial trial={trial} onReset={onReset} />;

  const isOnePump = trial.verdict_code === "one_pump_chump";
  const isLive = trial.data_mode === "live";
  const shortAddr = displayAddressShort(trial);

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

      {/* Coverage-limited disclosure (Robinhood cases) */}
      <CoverageNotice trial={trial} />

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
          <p className="font-mono italic text-court-navy text-base leading-relaxed">“{trial.defense_statement}”</p>
        </div>
      </div>

      {/* 3. Nansen Evidence */}
      <div className="mt-10">
        <NansenEvidence trial={trial} />
      </div>

      {/* 4. Sentence — the court's ruling */}
      <div className="mt-10">
        <SentenceRuling trial={trial} />
      </div>

      {/* 5. Serve the Defendant + Identity Panel */}
      <div className="mt-10">
        <SummonsSection trial={trial} proposedHandle={proposedHandle} />
      </div>

      {/* 6. Court Receipt */}
      <div className="mt-10">
        <CourtReceiptPreview trial={trial} />
      </div>

      {/* 7. Actions */}
      <div className="mt-10">
        <ShareActions trial={trial} onReset={onReset} />
      </div>

      {/* 8. Wallet ownership / Rap Sheet — hidden on demo cases */}
      {isLive && (
        <div className="mt-10">
          <ClaimWalletSection trial={trial} />
        </div>
      )}

      {/* 9. ShoutIt Public Gallery */}
      <div className="mt-12">
        <ShoutItGallery />
      </div>
    </section>
  );
}