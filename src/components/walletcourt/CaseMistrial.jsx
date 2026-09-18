import { motion } from "framer-motion";
import { Gavel } from "lucide-react";

// Phase N2.3 — public Mistrial experience. Shown when some onchain activity
// exists but the evidence is too thin to defensibly support any verdict.
// No severity, no verdict confidence. The completeness indicator is labeled
// "Evidence Completeness" — never verdict confidence.
function parseJson(s, fallback) {
  try { return JSON.parse(s) || fallback; } catch { return fallback; }
}

export default function CaseMistrial({ trial, onReset }) {
  const addr = trial.normalized_wallet_address || "";
  const shortAddr = addr ? (addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr) : "";

  const saved = parseJson(trial.metrics_json, {});
  const meta = saved._meta || {};
  const metrics = { ...saved };
  delete metrics._meta;
  const sources = parseJson(trial.source_endpoints_json, []);

  const available = sources.filter((s) => typeof s === "string" && s.endsWith(":live")).map((s) => s.split(":")[1]);
  const missing = sources.filter((s) => typeof s === "string" && s.endsWith(":unavailable")).map((s) => s.split(":")[1]);

  // Concise, public-safe description of the activity present (no verdict language).
  const activityParts = [];
  const trades = metrics.total_trades;
  const dex = metrics.dex_trade_count;
  const txCount = metrics.transaction_count;
  const holdings = metrics.token_balance_count;
  if (Number.isFinite(+holdings) && +holdings > 0) activityParts.push(`${holdings} token holding${+holdings === 1 ? "" : "s"}`);
  if (Number.isFinite(+trades) && +trades > 0) activityParts.push(`${trades} trade${+trades === 1 ? "" : "s"}`);
  if (Number.isFinite(+dex) && +dex > 0) activityParts.push(`${dex} DEX swap${+dex === 1 ? "" : "s"}`);
  if (Number.isFinite(+txCount) && +txCount > 0) activityParts.push(`${txCount} transaction${+txCount === 1 ? "" : "s"}`);
  const activityLine = activityParts.length
    ? `The record shows ${activityParts.join(", ")}.`
    : "The record shows only fragments of activity.";

  const availableLine = available.length
    ? `Evidence successfully available: ${available.join(", ")}.`
    : "No endpoint returned complete evidence.";
  const missingLine = missing.length
    ? `Material evidence missing: ${missing.join(", ")}.`
    : "No endpoint was missing, but the available evidence was too thin.";
  const whyLine = "The court will not enter a verdict it cannot defend on the available evidence.";

  // Evidence completeness (NOT verdict confidence).
  const total = sources.length || 1;
  const completenessPct = Math.round((available.length / total) * 100);

  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:pt-12 pb-20">
      {/* Slim case header */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-[0.14em] mb-8 border-2 border-court-ice bg-court-navy px-4 py-2">
        <span className="text-court-chart font-bold">Case No. {trial.public_slug?.slice(-8).toUpperCase()}</span>
        <span className="text-court-ice">{trial.network} · {shortAddr}</span>
        <span className="text-court-uv">{meta.partial ? "Partial · Nansen" : "Live · Nansen"}</span>
      </div>

      {/* Mistrial stamp */}
      <div className="text-center py-2">
        <motion.div
          initial={{ scale: 2.6, rotate: -18, opacity: 0 }}
          animate={{ scale: 1, rotate: -3, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 13, delay: 0.12 }}
          className="inline-block border-[3px] border-court-ice bg-court-uv px-8 py-3 font-display uppercase tracking-[0.1em] text-2xl sm:text-4xl text-court-ice shadow-[7px_7px_0_0_#000000]"
        >
          Mistrial
        </motion.div>
        <p className="mt-6 font-display uppercase tracking-[0.14em] text-court-ice text-lg sm:text-2xl">
          The Court Has Questions. The Evidence Doesn’t Have Answers.
        </p>
      </div>

      {/* Findings */}
      <div className="mt-10 border-2 border-court-ice bg-court-navy p-5 sm:p-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-court-chart mb-3">Findings · For the Record</p>
        <p className="font-mono text-court-ice leading-relaxed text-base">
          There is some onchain activity here, but not enough reliable evidence to deliver a defensible verdict.
        </p>
        <p className="mt-4 font-mono text-court-mute leading-relaxed text-base">{activityLine}</p>

        <ul className="mt-5 space-y-2 font-mono text-sm text-court-ice leading-relaxed">
          <li><span className="text-court-chart">Available: </span>{availableLine}</li>
          <li><span className="text-court-red">Missing: </span>{missingLine}</li>
          <li><span className="text-court-chart">Why no verdict: </span>{whyLine}</li>
        </ul>
      </div>

      {/* Evidence completeness indicator — explicitly NOT verdict confidence */}
      <div className="mt-8 border-2 border-court-ice bg-court-navy p-5 sm:p-6">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-xs uppercase tracking-[0.16em] text-court-chart">Evidence Completeness</span>
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute">Not Verdict Confidence</span>
        </div>
        <div className="h-3 w-full bg-court-uv border-2 border-court-ice">
          <div className="h-full bg-court-chart" style={{ width: `${completenessPct}%` }} />
        </div>
        <p className="mt-2 font-mono text-sm text-court-ice">{completenessPct}% of endpoints returned evidence ({available.length} of {total}).</p>
      </div>

      {/* Reset only */}
      <div className="mt-10">
        <button
          type="button"
          onClick={onReset}
          className="w-full inline-flex items-center justify-center gap-2 bg-court-red text-court-ice font-display uppercase tracking-[0.08em] text-base px-4 py-4 border-2 border-court-ice hover:brightness-105 transition-all"
        >
          <Gavel className="h-5 w-5" /> Roast Another Wallet
        </button>
      </div>
    </section>
  );
}