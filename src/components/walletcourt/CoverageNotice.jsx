// Coverage-limited disclosure for Robinhood cases (and any chain with a
// Nansen coverage start date). Shows when trial.coverage_limited is true,
// explaining that the evidence window was clamped to the chain's coverage
// start date.
import { AlertTriangle } from "lucide-react";

export default function CoverageNotice({ trial }) {
  if (!trial?.coverage_limited) return null;

  const fmtDate = (iso) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric"
      });
    } catch {
      return iso.slice(0, 10);
    }
  };

  const requested = trial.requested_window_days;
  const start = trial.effective_analysis_start;
  const end = trial.effective_analysis_end;

  return (
    <div className="border-2 border-court-red bg-court-navy px-4 py-3 mb-6">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-court-red mt-0.5 shrink-0" />
        <div className="font-mono text-sm text-court-ice leading-relaxed">
          <p className="text-court-red font-bold uppercase tracking-[0.1em] text-xs mb-1">
            Limited History Disclosure
          </p>
          <p>
            Nansen coverage for {trial.network} begins {fmtDate(start)}. The requested {requested ? `${requested}-day` : ""} analysis window was clamped to available data.
          </p>
          <p className="text-court-mute mt-1 text-xs">
            Effective evidence window: {fmtDate(start)} → {fmtDate(end)}. Verdict reflects only on-chain activity within this period.
          </p>
        </div>
      </div>
    </div>
  );
}