import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import SingleTradeVerdict from "@/components/walletcourt/SingleTradeVerdict";
import LoadingStage from "@/components/walletcourt/LoadingStage";
import { classifyCaseFetchResult } from "@/lib/routeState";
import { isSingleTradeRenderable } from "@/lib/singleTradeRenderable";
import { getSingleTradeErrorMessage } from "@/lib/singleTradeErrors";
import { RefreshCw, Loader2, RotateCcw, AlertTriangle } from "lucide-react";

export default function SingleTradeCase() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [trial, setTrial] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");

  // Check admin status once on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const user = await base44.auth.me();
        if (alive && user && user.role === "admin") setIsAdmin(true);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    (async () => {
      try {
        const res = await base44.functions.invoke("getSingleTradeBySlug", { slug });
        if (!alive) return;
        const result = res?.data;
        const classified = classifyCaseFetchResult(result, res?.status);
        if (classified === "done") {
          if (!isSingleTradeRenderable(result.trial)) {
            setError("This trade case was not completed and is not available for public viewing.");
            setStatus("notfound");
          } else {
            setTrial(result.trial);
            setStatus("done");
          }
        } else if (classified === "notfound") {
          setError(result?.error || "This trade case never made it to the docket.");
          setStatus("notfound");
        } else {
          setError(result?.error || "The court couldn't load this case. Try again.");
          setStatus("error");
        }
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "The court couldn't load this case. Try again.");
        setStatus("error");
      }
    })();
    return () => { alive = false; };
  }, [slug]);

  async function handleRetryLoad() {
    setError("");
    setStatus("loading");
    try {
      const res = await base44.functions.invoke("getSingleTradeBySlug", { slug });
      const result = res?.data;
      const classified = classifyCaseFetchResult(result, res?.status);
      if (classified === "done") {
        if (!isSingleTradeRenderable(result.trial)) {
          setError("This trade case was not completed and is not available for public viewing.");
          setStatus("notfound");
        } else {
          setTrial(result.trial);
          setStatus("done");
        }
      } else if (classified === "notfound") {
        setError(result?.error || "This trade case never made it to the docket.");
        setStatus("notfound");
      } else {
        setError(result?.error || "The court couldn't load this case. Try again.");
        setStatus("error");
      }
    } catch (e) {
      setError(e?.message || "The court couldn't load this case. Try again.");
      setStatus("error");
    }
  }

  // Admin retry: creates a new selection from the failed trial's stored
  // purchase details, then calls analyzeSingleTrade — no discovery call.
  async function handleAdminRetry() {
    setRetrying(true);
    setRetryError("");
    try {
      // 1. Create a new selection from the failed trial's stored details.
      const retryRes = await base44.functions.invoke("retrySingleTradeTrial", { slug });
      if (retryRes?.data?.error) {
        setRetryError(retryRes.data.error);
        return;
      }
      const { selection_token, wallet_address, network, token_mint } = retryRes.data;

      // 2. Call analyzeSingleTrade with the server-authoritative selection.
      setStatus("loading");
      const analysisRes = await base44.functions.invoke("analyzeSingleTrade", {
        wallet_address, network, token_mint, selection_token
      });
      const result = analysisRes?.data;
      if (result?.error) {
        setRetryError(result.error);
        setStatus("notfound");
        setError(result.error);
        return;
      }
      if (result?.court_recess) {
        setRetryError("The court is in recess. Please try again shortly.");
        setStatus("notfound");
        return;
      }
      if (!result?.trial || !isSingleTradeRenderable(result.trial)) {
        setRetryError("The retry did not produce a complete verdict. Please try again.");
        setStatus("notfound");
        return;
      }
      // Success — navigate to the new case slug.
      const newSlug = result.trial.public_slug;
      if (newSlug && newSlug !== slug) {
        navigate(`/trade/${newSlug}`, { replace: true });
      } else {
        setTrial(result.trial);
        setStatus("done");
      }
    } catch (e) {
      setRetryError(getSingleTradeErrorMessage(e, "Retry failed. Please try again."));
      setStatus("notfound");
    } finally {
      setRetrying(false);
    }
  }

  if (status === "loading") return <LoadingStage visible />;
  if (status === "done" && trial) {
    if (!isSingleTradeRenderable(trial)) {
      return (
        <UnavailableCase
          message="This trade case was not completed and is not available for public viewing."
          onBack={() => navigate("/")}
        />
      );
    }
    return (
      <div className="relative">
        <SingleTradeVerdict trial={trial} onReset={() => navigate("/")} />
        {trial.case_outcome === "verdict" && (
          <div className="mx-auto max-w-3xl px-4 pb-12 -mt-4">
            <RefreshButton slug={trial.public_slug} onRefreshed={(updated) => setTrial(updated)} />
          </div>
        )}
      </div>
    );
  }
  return (
    <UnavailableCase
      message={error || "This trade case never made it to the docket."}
      showRetry={status === "error"}
      onRetry={handleRetryLoad}
      onBack={() => navigate("/")}
      // Admin-only retry: re-analyzes the failed trade without a discovery call.
      showAdminRetry={isAdmin && (status === "notfound" || status === "error")}
      adminRetrying={retrying}
      adminRetryError={retryError}
      onAdminRetry={handleAdminRetry}
    />
  );
}

function UnavailableCase({ message, showRetry, onRetry, onBack, showAdminRetry, adminRetrying, adminRetryError, onAdminRetry }) {
  // Add a noindex meta tag so search engines do not index unavailable cases.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  return (
    <div className="mx-auto max-w-xl px-4 pt-20 pb-24">
      <div className="border-2 border-court-red bg-court-navy p-6 sm:p-8 text-center">
        <p className="font-display uppercase text-court-red text-3xl mb-3 tracking-[0.04em]">
          Case Unavailable
        </p>
        <p className="font-mono text-base text-court-ice mb-6 leading-relaxed">
          {message || "This trade case is not available for public viewing."}
        </p>

        {showAdminRetry && (
          <div className="mb-6 border-2 border-court-chart/60 bg-court-uv/30 p-4">
            <p className="font-mono text-sm text-court-chart mb-3 leading-relaxed">
              Admin: retry the analysis using the original purchase details — no new discovery call needed.
            </p>
            <button
              onClick={onAdminRetry}
              disabled={adminRetrying}
              className="inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50"
            >
              {adminRetrying ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
              Retry Analysis
            </button>
            {adminRetryError && (
              <div className="mt-3 flex items-start gap-2 text-left">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-court-red" />
                <span className="font-mono text-xs text-court-red leading-relaxed">{adminRetryError}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3">
          {showRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center justify-center bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
            >
              Reload Case
            </button>
          )}
          <button
            onClick={onBack}
            className="inline-flex items-center justify-center border-2 border-court-ice text-court-ice font-display uppercase tracking-[0.12em] text-base px-6 py-3 hover:bg-court-uv transition-colors"
          >
            Back to Court
          </button>
        </div>
      </div>
    </div>
  );
}

function RefreshButton({ slug, onRefreshed }) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function handleRefresh() {
    setRefreshing(true); setError("");
    try {
      const res = await base44.functions.invoke("refreshSingleTrade", { slug });
      if (res?.data?.error) {
        setError(res.data.error);
      } else if (res?.data?.trial) {
        onRefreshed(res.data.trial);
      }
    } catch (e) {
      setError(e?.message || "Refresh failed. Sign in to refresh a trade case.");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={refreshing}
        className="inline-flex items-center gap-2 border-2 border-court-chart/70 text-court-chart font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 hover:bg-court-chart hover:text-court-navy transition-colors disabled:opacity-50"
      >
        {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Refresh Current Status
      </button>
      {error && <p className="font-mono text-xs text-court-red text-center">{error}</p>}
    </div>
  );
}