import { useMemo } from "react";
import VerdictStamp from "./VerdictStamp";
import SeverityMeter from "./SeverityMeter";
import NansenEvidence from "./NansenEvidence";
import SentenceRuling from "./SentenceRuling";
import CourtReceiptPreview from "./CourtReceiptPreview";
import ShareActions from "./ShareActions";
import CaseDismissed from "./CaseDismissed";
import CaseMistrial from "./CaseMistrial";
import { getCaseOutcome } from "@/lib/caseOutcome";
import { displayAddressShort } from "@/lib/wallet";

// Parse the metrics_json from the sanitized trial response.
function useTradeMetrics(trial) {
  return useMemo(() => {
    try {
      const m = JSON.parse(trial.metrics_json || "{}");
      return m && typeof m === "object" ? m : {};
    } catch {
      return {};
    }
  }, [trial.metrics_json]);
}

function fmtUsd(v) {
  if (v === null || v === undefined) return "—";
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function fmtPct(v) {
  if (v === null || v === undefined) return "—";
  const pct = v * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function fmtPctPlain(v) {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDuration(days) {
  if (days === null || days === undefined) return "—";
  if (days < 1) return `${Math.round(days * 24)}h`;
  if (days < 30) return `${days.toFixed(1)}d`;
  return `${(days / 30).toFixed(1)}mo`;
}

function fmtTokens(v) {
  if (v === null || v === undefined) return "—";
  return Math.round(v).toLocaleString();
}

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

// A single trade metric row in the evidence panel.
function MetricRow({ label, value, accent }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-court-mute/20 px-3 py-2">
      <span className="font-mono text-xs uppercase tracking-[0.1em] text-court-mute">{label}</span>
      <span className={`font-mono text-sm ${accent || "text-court-ice"}`}>{value}</span>
    </div>
  );
}

// The Single Trade purchase + position details panel.
function TradeDetailsPanel({ trial, metrics }) {
  const symbol = trial.token_symbol || "Unknown Token";
  const chain = (trial.network || "").toUpperCase();
  const entryPrice = trial.entry_price_usd;
  const entryValue = trial.purchase_cost_usd;
  const currentValue = trial.current_value_usd;
  const currentReturn = metrics.current_unrealized_pnl_pct;
  const maxDrawdown = metrics.max_drawdown_pct;
  const holdingDays = metrics.holding_duration_days;
  const conviction = metrics.conviction;
  const heldAmount = trial.tokens_received;
  const soldAmount = metrics.total_tokens_sold;
  const stillHeld = conviction === "full_exit" ? 0 : (metrics.selected_lot_remaining_quantity ?? heldAmount);

  return (
    <div className="border-2 border-court-ice bg-court-navy">
      <div className="flex items-center justify-between border-b-2 border-court-ice bg-court-uv px-4 py-2">
        <span className="font-display uppercase tracking-[0.08em] text-court-chart text-sm">The Trade · Evidence File</span>
        <span className="font-mono text-xs text-court-ice">{chain} · {symbol}</span>
      </div>
      <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-court-mute/20">
        <div>
          <MetricRow label="Purchase Date" value={fmtDate(trial.purchase_timestamp)} />
          <MetricRow label="Entry Price" value={entryPrice != null ? `$${entryPrice.toFixed(6)}` : "—"} />
          <MetricRow label="Entry Value" value={fmtUsd(entryValue)} />
          <MetricRow label="Tokens Received" value={fmtTokens(heldAmount)} accent="text-court-chart" />
        </div>
        <div>
          <MetricRow label="Current Value" value={fmtUsd(currentValue)} />
          <MetricRow label="Current Return" value={fmtPct(currentReturn)} accent={currentReturn != null && currentReturn >= 0 ? "text-court-chart" : "text-court-red"} />
          <MetricRow label="Max Drawdown" value={fmtPct(maxDrawdown)} accent="text-court-red" />
          <MetricRow label="Holding Duration" value={fmtDuration(holdingDays)} />
          <MetricRow label="Still Held" value={fmtTokens(stillHeld)} />
          {soldAmount != null && soldAmount > 0 && (
            <MetricRow label="Sold" value={fmtTokens(soldAmount)} />
          )}
        </div>
      </div>
      {metrics._meta && metrics._meta.partial && (
        <div className="border-t-2 border-court-red/40 bg-court-red/5 px-4 py-2">
          <p className="font-mono text-xs text-court-red/90 leading-relaxed">
            Limited data: some Nansen endpoints were unavailable for this analysis. Metrics may be incomplete.
          </p>
        </div>
      )}
    </div>
  );
}

export default function SingleTradeVerdict({ trial, onReset }) {
  const outcome = getCaseOutcome(trial);
  const metrics = useTradeMetrics(trial);

  // Route dismissed/mistrial to dedicated views.
  if (outcome === "dismissed_no_evidence") return <CaseDismissed trial={trial} onReset={onReset} />;
  if (outcome === "mistrial_insufficient_evidence") return <CaseMistrial trial={trial} onReset={onReset} />;

  const shortAddr = displayAddressShort(trial);
  const isLive = trial.data_mode === "live";

  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:pt-12 pb-20">
      {/* Slim case header */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-[0.14em] mb-8 border-2 border-court-ice bg-court-navy px-4 py-2">
        <span className="text-court-chart font-bold">Trade No. {trial.public_slug?.slice(-8).toUpperCase()}</span>
        <span className="text-court-ice">{trial.network} · {shortAddr}</span>
        <span className={isLive ? "text-court-chart" : "text-court-red"}>
          {isLive ? "Live · Nansen" : "Demo Mode"}
        </span>
      </div>

      {/* 1. Verdict */}
      <VerdictStamp trial={trial} />

      {/* Severity & confidence */}
      <div className="mt-8">
        <SeverityMeter severity={trial.severity_score} confidence={trial.confidence_score} />
      </div>

      {/* 2. Trade details panel (Single Trade specific) */}
      <div className="mt-10">
        <TradeDetailsPanel trial={trial} metrics={metrics} />
      </div>

      {/* 3. Roast */}
      <div className="mt-10 border-2 border-court-ice bg-court-ice p-5 sm:p-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-court-red mb-3">The Roast · For the Record</p>
        <p className="font-mono text-court-navy leading-relaxed text-base">{trial.roast}</p>
        <div className="mt-4 border-l-4 border-court-red pl-4">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-court-red mb-1">Defense entered</p>
          <p className="font-mono italic text-court-navy text-base leading-relaxed">"{trial.defense_statement}"</p>
        </div>
      </div>

      {/* 4. Nansen Evidence */}
      <div className="mt-10">
        <NansenEvidence trial={trial} />
      </div>

      {/* 5. Sentence */}
      <div className="mt-10">
        <SentenceRuling trial={trial} />
      </div>

      {/* 6. Court Receipt */}
      <div className="mt-10">
        <CourtReceiptPreview trial={trial} />
      </div>

      {/* 7. Actions */}
      <div className="mt-10">
        <ShareActions trial={trial} onReset={onReset} />
      </div>
    </section>
  );
}