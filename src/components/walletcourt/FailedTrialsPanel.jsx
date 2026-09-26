import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { getSingleTradeErrorMessage, getSingleTradeErrorCode } from "@/lib/singleTradeErrors";
import { isSingleTradeRenderable } from "@/lib/singleTradeRenderable";
import { AlertTriangle, Loader2, RotateCcw, RefreshCw, ExternalLink, Check } from "lucide-react";

// Error codes that indicate another retry attempt would not be safe or
// useful. When the retry returns one of these, the retry button stays
// disabled for that trial.
const PERMANENT_RETRY_ERRORS = new Set([
  "FORBIDDEN",
  "NOT_FOUND",
  "NOT_FAILED",
  "UNSUPPORTED_CHAIN",
  "MISSING_PURCHASE_DETAILS",
  "BUDGET_EXHAUSTED",
  "FEATURE_DISABLED",
  "EMERGENCY_STOP",
]);

export default function FailedTrialsPanel() {
  const [trials, setTrials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Per-trial retry state, keyed by public_slug.
  const [retryingSlug, setRetryingSlug] = useState(null);
  const [retryResults, setRetryResults] = useState({}); // { [slug]: { status, newSlug, message } }
  const [blockedSlugs, setBlockedSlugs] = useState(new Set());

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await base44.functions.invoke("getSingleTradeFailedTrials", {});
      if (res?.data?.error) {
        setError(res.data.error);
      } else if (res?.data?.trials) {
        setTrials(res.data.trials);
      }
    } catch (e) {
      setError(e?.message || "Failed to load failed trials.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleRetry(slug) {
    if (retryingSlug) return; // prevent double submission
    setRetryingSlug(slug);
    // Clear previous result for this slug.
    setRetryResults((prev) => ({ ...prev, [slug]: null }));
    try {
      // 1. Create a new selection from the failed trial's stored details.
      const retryRes = await base44.functions.invoke("retrySingleTradeTrial", { slug });
      if (retryRes?.data?.error) {
        const code = retryRes.data.code || null;
        setRetryResults({
          ...retryResults,
          [slug]: { status: "error", message: getSingleTradeErrorMessage({ data: retryRes.data }, "Retry failed.") }
        });
        if (PERMANENT_RETRY_ERRORS.has(code)) {
          setBlockedSlugs((prev) => new Set([...prev, slug]));
        }
        return;
      }
      const { selection_token, wallet_address, network, token_mint } = retryRes.data;

      // 2. Call analyzeSingleTrade with the server-authoritative selection.
      const analysisRes = await base44.functions.invoke("analyzeSingleTrade", {
        wallet_address, network, token_mint, selection_token
      });
      const result = analysisRes?.data;
      if (result?.error) {
        const code = result.code || null;
        setRetryResults({
          ...retryResults,
          [slug]: { status: "error", message: getSingleTradeErrorMessage({ data: result }, "Analysis failed.") }
        });
        if (PERMANENT_RETRY_ERRORS.has(code)) {
          setBlockedSlugs((prev) => new Set([...prev, slug]));
        }
        return;
      }
      if (result?.court_recess) {
        setRetryResults({
          ...retryResults,
          [slug]: { status: "error", message: getSingleTradeErrorMessage({ data: { court_recess: true } }, "The court is in recess. Please try again shortly.") }
        });
        return;
      }
      if (!result?.trial || !isSingleTradeRenderable(result.trial)) {
        setRetryResults({
          ...retryResults,
          [slug]: { status: "error", message: "The retry did not produce a complete verdict. Please try again." }
        });
        return;
      }
      // Success — record the new case slug.
      setRetryResults({
        ...retryResults,
        [slug]: { status: "success", newSlug: result.trial.public_slug, message: "Retry succeeded." }
      });
    } catch (e) {
      const code = getSingleTradeErrorCode(e);
      setRetryResults({
        ...retryResults,
        [slug]: { status: "error", message: getSingleTradeErrorMessage(e, "Retry failed. Please try again.") }
      });
      if (PERMANENT_RETRY_ERRORS.has(code)) {
        setBlockedSlugs((prev) => new Set([...prev, slug]));
      }
    } finally {
      setRetryingSlug(null);
    }
  }

  return (
    <div className="border-2 border-court-red/60 bg-court-navy mb-6">
      <div className="flex items-center justify-between border-b-2 border-court-red/60 px-4 sm:px-5 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-court-red" />
          <h2 className="font-display uppercase tracking-[0.08em] text-court-red text-base">Failed Trials</h2>
          {!loading && trials.length > 0 && (
            <span className="font-mono text-xs text-court-mute">{trials.length} failed</span>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 font-mono text-xs text-court-mute hover:text-court-ice transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
      </div>

      <div className="px-4 sm:px-5 py-4">
        {error && (
          <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-2.5 text-sm text-court-red mb-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="font-mono leading-relaxed">{error}</span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 font-mono text-sm text-court-mute animate-blink">Loading failed trials…</div>
        ) : trials.length === 0 ? (
          <div className="py-8 text-center">
            <Check className="h-6 w-6 text-court-chart mx-auto mb-2" />
            <p className="font-mono text-sm text-court-mute">No failed trials. The docket is clean.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {trials.map((t) => {
              const result = retryResults[t.public_slug];
              const isRetrying = retryingSlug === t.public_slug;
              const isBlocked = blockedSlugs.has(t.public_slug);
              return (
                <div key={t.public_slug} className="border-2 border-court-mute/25 bg-court-navy/60 px-3.5 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
                    <span className="font-mono text-sm text-court-ice font-semibold">
                      {t.token_symbol || "Unknown"}
                    </span>
                    <span className="font-mono text-xs text-court-mute uppercase">{t.network}</span>
                    <span className="font-mono text-xs text-court-mute">{t.address_short}</span>
                    <span className="font-mono text-xs text-court-mute/70 truncate">tx {t.transaction_hash_short}</span>
                  </div>
                  {t.error_message && (
                    <p className="font-mono text-xs text-court-red/90 mb-2 leading-relaxed break-words">
                      {t.error_message}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRetry(t.public_slug)}
                      disabled={isRetrying || isBlocked}
                      className={cn(
                        "inline-flex items-center gap-1.5 font-display uppercase tracking-[0.08em] text-xs px-3 py-2 border-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                        "bg-court-chart text-court-navy border-court-navy shadow-[3px_3px_0_0_#FF3B30] hover:shadow-none hover:translate-x-0.5 hover:translate-y-0.5"
                      )}
                    >
                      {isRetrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      Retry Analysis
                    </button>
                    <Link
                      to={`/trade/${t.public_slug}`}
                      className="inline-flex items-center gap-1 font-mono text-xs text-court-mute hover:text-court-ice transition-colors"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  {result?.status === "success" && result.newSlug && (
                    <div className="mt-2 flex items-center gap-2 border-2 border-court-chart/50 bg-court-chart/10 px-3 py-2">
                      <Check className="h-3.5 w-3.5 text-court-chart shrink-0" />
                      <span className="font-mono text-xs text-court-chart">Retry succeeded.</span>
                      <Link
                        to={`/trade/${result.newSlug}`}
                        className="inline-flex items-center gap-1 font-mono text-xs text-court-chart underline hover:brightness-125"
                      >
                        View new case <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  )}
                  {result?.status === "error" && (
                    <div className="mt-2 flex items-start gap-2 border-2 border-court-red/50 bg-court-red/10 px-3 py-2">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-court-red" />
                      <span className="font-mono text-xs text-court-red leading-relaxed">{result.message}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}