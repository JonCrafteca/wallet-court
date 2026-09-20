import { Link } from "react-router-dom";
import { ArrowRight, Share2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortClassLabel, hasMeaningfulClass } from "@/lib/walletClass";
import { NOT_GUILTY_STYLE } from "@/lib/verdictStamp";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";

// Honor card with canonical NOT GUILTY stamp. Uses the exact global lime
// background, dark navy text/border, offset shadow, and rotation from
// notGuiltyStamp — never a custom or drifted treatment.
export default function HonorCard({ c, onShare }) {
  const date = c.analyzed_at ? new Date(c.analyzed_at).toLocaleDateString() : "—";
  return (
    <Link
      to={`/case/${c.slug}`}
      onClick={() => trackShare(SHARE_EVENTS.HALL_HONOR_CASE_OPENED, { case_slug: c.slug })}
      className="group flex flex-col h-full border-2 border-court-chart bg-court-navy p-5 hover:bg-court-uv transition-colors"
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className="inline-block border-4 px-3 py-1 font-display uppercase tracking-[0.1em] text-sm shadow-[4px_4px_0_0_#10142A] -rotate-6"
          style={{
            background: NOT_GUILTY_STYLE.bg,
            color: NOT_GUILTY_STYLE.text,
            borderColor: NOT_GUILTY_STYLE.border,
          }}
        >
          {NOT_GUILTY_STYLE.label}
        </span>
        {hasMeaningfulClass(c.wallet_class) && (
          <span className="font-mono text-xs uppercase tracking-[0.1em] text-court-chart border-2 border-court-chart/60 px-2 py-0.5">
            {shortClassLabel(c.wallet_class)}
          </span>
        )}
      </div>

      <p className="font-display uppercase text-court-ice text-xl leading-tight mb-2">{c.verdict_name}</p>
      <p className="font-mono text-sm text-court-ice mb-2">{c.address_short}</p>
      <p className="font-mono text-xs text-court-mute mb-3">{c.network}</p>

      {c.highlight && (
        <p className="font-mono text-sm text-court-chart mb-3 leading-relaxed">{c.highlight}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm text-court-mute mb-3">
        <span>Conf {c.confidence_score?.toFixed(0)}%</span>
        <span>{date}</span>
      </div>

      <div className="flex items-center gap-1 font-mono text-xs uppercase tracking-[0.12em] text-court-ice group-hover:text-court-chart">
        View Case
        <ArrowRight className="h-3.5 w-3.5" />
      </div>

      {onShare && (
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); onShare(c); }}
          className="mt-3 inline-flex items-center justify-center gap-1.5 border-2 border-court-ice text-court-ice font-mono text-xs uppercase tracking-[0.1em] px-3 py-2 hover:bg-court-uv transition-colors"
        >
          <Share2 className="h-3.5 w-3.5" /> Share
        </button>
      )}
    </Link>
  );
}