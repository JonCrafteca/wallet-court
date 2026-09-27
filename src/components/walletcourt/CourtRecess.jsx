import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Gavel, RotateCw, Scale } from "lucide-react";

// Phase N2.4 — public Court Recess experience. Shown when an operational /
// provider failure prevented the court from obtaining enough reliable evidence.
// No verdict, dismissal, mistrial, severity, confidence, charge, sentence,
// evidence, share, challenge, badge, or award is shown. The wallet is not blamed.
//
// Props:
//   recessType   — court_recess_* classification (optional, controls tone)
//   retryAfter   — ISO timestamp when the court may reconvene (optional)
//   onRetry      — re-submit the same wallet (enabled once the window elapses)
//   onReset      — return to the intake form
export default function CourtRecess({ recessType, retryAfter, reason, onRetry, onReset }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const retryMs = retryAfter ? new Date(retryAfter).getTime() : 0;
  const remainingSec = Number.isFinite(retryMs) ? Math.max(0, Math.ceil((retryMs - now) / 1000)) : 0;
  const canRetry = !retryMs || now >= retryMs;
  const minutes = Math.max(1, Math.ceil(remainingSec / 60));

  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:pt-12 pb-20">
      {/* Operational banner — not a verdict stamp */}
      <div className="text-center py-2">
        <motion.div
          initial={{ scale: 2.6, rotate: -18, opacity: 0 }}
          animate={{ scale: 1, rotate: -2, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 13, delay: 0.12 }}
          className="inline-block border-[3px] border-court-chart bg-court-uv px-8 py-3 font-display uppercase tracking-[0.1em] text-2xl sm:text-4xl text-court-ice shadow-[7px_7px_0_0_#000000]"
        >
          Court in Recess
        </motion.div>
        <p className="mt-6 font-display uppercase tracking-[0.14em] text-court-ice text-lg sm:text-2xl">
          The Evidence Clerk Is Temporarily Unavailable.
        </p>
      </div>

      {/* Findings — operational, no guilt language */}
      <div className="mt-10 border-2 border-court-chart bg-court-navy p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <Scale className="h-5 w-5 text-court-chart shrink-0" />
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-court-chart">Notice · For the Record</p>
        </div>
        <p className="font-mono text-court-ice leading-relaxed text-base">
          {reason || "No verdict has been entered and this wallet has not been judged. The court could not obtain enough reliable evidence to convene."}
        </p>
        <p className="mt-4 font-mono text-court-mute leading-relaxed text-base">
          {recessType === "court_recess_ceiling"
            ? "This is a budget limit on the court\u2019s side, not something the wallet did. No further analyses are available until the court administrator restores capacity."
            : "This is an operational issue on the court\u2019s side, not something the wallet did. Try the case again shortly."}
        </p>
      </div>

      {/* Retry window */}
      <div className="mt-8 border-2 border-court-ice bg-court-navy p-5 sm:p-6">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-court-chart">Reconvene Estimate</span>
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute">Operational · Not Verdict</span>
        </div>
        {canRetry ? (
          <p className="font-display uppercase tracking-[0.06em] text-court-chart text-xl">
            The court is ready to reconvene.
          </p>
        ) : (
          <p className="font-display uppercase tracking-[0.06em] text-court-ice text-xl">
            Court expected to reconvene in approximately {minutes} minute{minutes === 1 ? "" : "s"}.
          </p>
        )}
        {!canRetry && (
          <div className="mt-3 h-3 w-full bg-court-uv border-2 border-court-ice">
            <div className="h-full bg-court-chart transition-all" style={{ width: `${Math.max(4, 100 - (remainingSec / Math.max(1, remainingSec + 60)) * 100)}%` }} />
          </div>
        )}
      </div>

      {/* Actions — retry + return to docket. No share, no challenge, no badges. */}
      <div className="mt-10 space-y-3">
        <button
          type="button"
          onClick={onRetry}
          disabled={!canRetry}
          className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-base px-4 py-4 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 disabled:cursor-not-allowed"
        >
          <RotateCw className="h-5 w-5" /> {canRetry ? "Try Again" : `Try Again in ${remainingSec}s`}
        </button>
        <Link
          to="/hall"
          className="w-full inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.08em] text-base px-4 py-4 border-2 border-court-ice hover:bg-court-uv transition-colors"
        >
          <Gavel className="h-5 w-5" /> Return to the Public Docket
        </Link>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="w-full font-mono text-sm text-court-mute uppercase tracking-[0.12em] py-2 hover:text-court-ice transition-colors"
          >
            Roast a different wallet
          </button>
        )}
      </div>
    </section>
  );
}