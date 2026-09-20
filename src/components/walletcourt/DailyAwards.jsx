import { Link } from "react-router-dom";
import { ArrowRight, Share2, Trophy, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";
import { buildCaseUrl, xIntentUrl } from "@/lib/courtDispatch";
import { truncateForX } from "@/lib/summonsHelpers";
import { X_CHAR_LIMIT } from "@/lib/shareConfig";

// Daily Court Awards: Bag of the Day + Dump of the Day.
// Desktop: side by side. Mobile: stacked vertically, compact.
// Winners are deterministic from frozen candidate cohorts (see hallSelection).
// Zero Nansen calls — reads only saved case records.

function awardPostText(awardType, verdictName, score, caseUrl) {
  if (awardType === "bag") {
    return [
      "🏆 BAG OF THE DAY",
      "",
      `The court recognizes a suspiciously competent wallet: ${verdictName}.`,
      `Confidence: ${Math.round(score || 0)}%`,
      "",
      `See the evidence: ${caseUrl}`,
    ].join("\n");
  }
  return [
    "🗑️ DUMP OF THE DAY",
    "",
    `The court's strongest shame-side verdict: ${verdictName}.`,
    `Severity: ${Math.round(score || 0)}/100`,
    "",
    `See the evidence: ${caseUrl}`,
  ].join("\n");
}

function AwardCard({ award, type, onOpenCase }) {
  if (!award) {
    return (
      <div className="border-2 border-dashed border-court-mute bg-court-navy p-5 text-center">
        <p className="font-display uppercase tracking-[0.06em] text-court-mute text-lg mb-1">
          {type === "bag" ? "🏆 Bag of the Day" : "🗑️ Dump of the Day"}
        </p>
        <p className="font-mono text-sm text-court-mute leading-relaxed">
          No qualifying {type === "bag" ? "performance" : "guilty"} case completed yet today.
        </p>
      </div>
    );
  }

  const isBag = type === "bag";
  const score = isBag ? award.confidence_score : award.severity_score;
  const scoreLabel = isBag ? "Confidence" : "Severity";
  const icon = isBag ? <Trophy className="h-5 w-5" /> : <Trash2 className="h-5 w-5" />;
  const accent = isBag ? "border-court-chart" : "border-court-red";

  function handleShare(e) {
    e.preventDefault();
    const url = buildCaseUrl(award.slug);
    const post = truncateForX(awardPostText(type, award.verdict_name, score, url), X_CHAR_LIMIT);
    window.open(xIntentUrl(post), "_blank", "noopener,noreferrer");
    trackShare(SHARE_EVENTS.DAILY_AWARD_SHARED, { award_type: type, verdict_code: award.verdict_code, case_slug: award.slug });
  }

  return (
    <Link
      to={`/case/${award.slug}`}
      onClick={() => trackShare(SHARE_EVENTS.DAILY_AWARD_OPENED, { award_type: type, case_slug: award.slug })}
      className={cn("group flex flex-col h-full border-2 bg-court-navy p-5 hover:bg-court-uv transition-colors", accent)}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className={cn("inline-flex items-center gap-1.5 font-display uppercase tracking-[0.06em] text-lg", isBag ? "text-court-chart" : "text-court-red")}>
          {icon}
          {isBag ? "Bag of the Day" : "Dump of the Day"}
        </span>
      </div>

      <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-2">
        Award date: {award.award_date}
      </p>

      <p className="font-display uppercase text-court-ice text-xl leading-tight mb-2">{award.verdict_name}</p>
      <p className="font-mono text-sm text-court-ice mb-3">{award.address_short}</p>

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm text-court-mute mb-3">
        <span>{award.network}</span>
        <span>{scoreLabel} {score?.toFixed(0)}{isBag ? "%" : "/100"}</span>
      </div>

      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 font-mono text-xs uppercase tracking-[0.12em] text-court-ice group-hover:text-court-chart">
          View Case <ArrowRight className="h-3.5 w-3.5" />
        </span>
        <button
          type="button"
          onClick={handleShare}
          className="inline-flex items-center gap-1.5 border-2 border-court-ice text-court-ice font-mono text-xs uppercase tracking-[0.1em] px-3 py-1.5 hover:bg-court-red hover:border-court-red transition-colors"
        >
          <Share2 className="h-3.5 w-3.5" /> Share
        </button>
      </div>
    </Link>
  );
}

export default function DailyAwards({ bag, dump }) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      <AwardCard award={bag} type="bag" />
      <AwardCard award={dump} type="dump" />
    </div>
  );
}