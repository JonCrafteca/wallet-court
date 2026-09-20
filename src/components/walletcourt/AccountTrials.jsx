import { Link } from "react-router-dom";
import { Gavel, ArrowRight } from "lucide-react";
import { getCaseOutcome } from "@/lib/caseOutcome";

const OUTCOME_BADGE = {
  verdict: { label: "Verdict", cls: "bg-court-chart text-court-navy" },
  demo: { label: "Demo", cls: "bg-court-chart text-court-navy" },
  dismissed_no_evidence: { label: "Dismissed", cls: "bg-court-mute text-court-navy" },
  mistrial_insufficient_evidence: { label: "Mistrial", cls: "bg-court-red text-court-ice" }
};

export default function AccountTrials({ trials }) {
  if (!trials || trials.length === 0) {
    return (
      <section>
        <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">My Trials</h2>
        <div className="border-2 border-court-ice bg-court-navy p-6 text-center">
          <Gavel className="h-8 w-8 text-court-mute mx-auto mb-3" />
          <p className="font-mono text-sm text-court-ice mb-4">No cases on the docket yet.</p>
          <p className="font-mono text-xs text-court-mute mb-4">Anyone can put a public wallet on trial — no ownership required.</p>
          <Link
            to="/"
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy hover:brightness-105 transition-all"
          >
            Put a Wallet on Trial <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">My Trials</h2>
      <div className="space-y-2">
        {trials.map((t) => {
          const outcome = getCaseOutcome(t);
          const badge = OUTCOME_BADGE[outcome] || OUTCOME_BADGE.verdict;
          return (
            <Link
              key={t.public_slug}
              to={`/case/${t.public_slug}`}
              className="flex items-center gap-3 border-2 border-court-ice bg-court-navy p-3 hover:bg-court-uv transition-colors"
            >
              <span className={`shrink-0 px-2 py-1 font-mono text-xs uppercase tracking-[0.1em] ${badge.cls}`}>
                {badge.label}
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm text-court-ice truncate">
                  {t.network} · {t.address_short}
                </p>
                {t.verdict_name && <p className="font-display text-sm text-court-chart truncate">{t.verdict_name}</p>}
              </div>
              {t.severity_score != null && (
                <span className="hidden sm:inline shrink-0 font-mono text-xs text-court-mute">Severity {t.severity_score}</span>
              )}
              <span className="shrink-0 font-mono text-xs text-court-mute">
                {t.analyzed_at ? new Date(t.analyzed_at).toLocaleDateString() : ""}
              </span>
              <ArrowRight className="h-4 w-4 text-court-mute shrink-0" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}