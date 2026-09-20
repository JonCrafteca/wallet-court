import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortClassLabel, hasMeaningfulClass } from "@/lib/walletClass";

// Reusable case card for Hall sections and category views. Displays only
// sanitized public fields — never full addresses or private data.
export default function CaseCard({ c, rank }) {
  const isLive = c.data_mode === "live";
  const date = c.analyzed_at ? new Date(c.analyzed_at).toLocaleDateString() : "—";
  return (
    <Link
      to={`/case/${c.slug}`}
      className="group flex flex-col h-full border-2 border-court-ice bg-court-navy p-5 hover:border-court-chart transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        {rank != null && (
          <span className="font-display text-court-chart text-lg leading-none">#{rank}</span>
        )}
        <span
          className={cn(
            "font-mono text-xs uppercase tracking-[0.1em] px-2 py-1 border-2",
            isLive
              ? "border-court-chart bg-court-chart text-court-navy"
              : "border-court-red bg-court-red text-court-ice"
          )}
        >
          {isLive ? "Live · Nansen" : "Demo"}
        </span>
      </div>

      <p className="font-mono text-sm text-court-ice mb-2">{c.address_short}</p>
      {hasMeaningfulClass(c.wallet_class) && (
        <span className="inline-block self-start font-mono text-xs uppercase tracking-[0.1em] text-court-chart border border-court-chart/60 px-2 py-0.5 mb-3">
          {shortClassLabel(c.wallet_class)}
        </span>
      )}
      <p className="font-display uppercase text-court-ice text-xl leading-tight mb-4">{c.verdict_name}</p>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm text-court-mute">
        <span>{c.network}</span>
        {c.severity_score != null && <span>Sev {c.severity_score?.toFixed(0)}</span>}
        <span>Conf {c.confidence_score?.toFixed(0)}%</span>
        <span>{date}</span>
      </div>

      {c.trial_count > 1 && (
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.1em] text-court-chart">
          Tried {c.trial_count?.toLocaleString()} times
        </p>
      )}

      <div className="mt-3 flex items-center gap-1 font-mono text-xs uppercase tracking-[0.12em] text-court-ice group-hover:text-court-chart">
        View Case
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}