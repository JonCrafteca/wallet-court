import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import SingleTradeVerdict from "@/components/walletcourt/SingleTradeVerdict";
import LoadingStage from "@/components/walletcourt/LoadingStage";
import { classifyCaseFetchResult } from "@/lib/routeState";
import { extractApiError } from "@/lib/apiError";
import { isSingleTradeRenderable } from "@/lib/singleTradeRenderable";
import { getSingleTradeErrorMessage } from "@/lib/singleTradeErrors";
import { getSingleTradeAccess } from "@/lib/singleTradeAccess";
import { RefreshCw, Loader2, RotateCcw, AlertTriangle } from "lucide-react";

// Extract the HTTP status and backend error message from any Base44 SDK
// error shape (axios AxiosError, bare Error, or response-with-error-body).
// Classifies the result so a backend 404 (non-renderable trial) enters the
// "notfound" state — NOT the transient "error" state. Only network errors,
// timeouts, and 5xx responses enter "error" (which shows Reload Case).
function classifyFetchError(e) {
  const apiErr = extractApiError(e, "The court couldn't load this case. Try again.");
  const rawStatus = apiErr.status ?? e?.status ?? e?.data?.status ?? e?.response?.status ?? null;
  const status = rawStatus != null ? Number(rawStatus) : null;
  const classified = classifyCaseFetchResult({ error: apiErr.message }, status);
  return { message: apiErr.message, status, classified };
}

// Error codes that indicate another retry attempt would not be safe or
// useful. When the retry returns one of these, the Retry Analysis button
// stays disabled (retryBlocked) to prevent futile repeated clicks.
const PERMANENT_RETRY_ERRORS = new Set([
  "FORBIDDEN",
  "NOT_FOUND",
  "NOT_FAILED",
  "UNSUPPORTED_CHAIN",
  "MISSING_PURCHASE_DETAILS",
  "BUDGET_EXHAUSTED",
  "ANALYSIS_PROCESSING",
  "FEATURE_DISABLED",
  "EMERGENCY_STOP",
]);

export default function SingleTradeCase() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [trial, setTrial] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [access, setAccess] = useState(null); // null = loading; object = resolved
  const [accessLoading, setAccessLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState("");
  const [retryBlocked, setRetryBlocked] = useState(false);
  const retryingRef = useRef(false);

  // Resolve Single Trade access independently from the case fetch, using the
  // server-authoritative getSingleTradeAccess function. This does NOT rely on
  // the returned trial object or the failed fetch to determine admin status.
  // Fails closed (no retry button) while loading or if access resolution fails.
  useEffect(() => {
    let alive = true;
    (async () => {
      const result = await getSingleTradeAccess();
      if (!alive) return;
      setAccess(result);
      setAccessLoading(false);
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
        const { message, classified } = classifyFetchError(e);
        if (classified === "notfound") {
          setError(message || "This trade case was not completed and is unavailable.");
          setStatus("notfound");
        } else {
          setError(message);
          setStatus("error");
        }
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
      const { message, classified } = classifyFetchError(e);
      if (classified === "notfound") {
        setError(message || "This trade case was not completed and is unavailable.");
        setStatus("notfound");
      } else {
        setError(message);
        setStatus("error");
      }
    }
  }

  // Admin retry: creates a new selection from the failed trial's stored
  // purchase details, then calls analyzeSingleTrade — no discovery call.
  // Uses a ref guard to prevent double submission. Re-enables the button
  // only when another attempt is safe (transient errors). Permanent errors
  // (budget exhausted, not failed, not found, unsupported chain, etc.)
  // block further retries via retryBlocked.
  async function handleAdminRetry() {
    if (retryingRef.current) return; // prevent double submission
    retryingRef.current = true;
    setRetrying(true);
    setRetryError("");
    try {
      // 1. Create a new selection from the failed trial's stored details.
      const retryRes = await base44.functions.invoke("retrySingleTradeTrial", { slug });
      if (retryRes?.data?.error) {
        const code = retryRes.data.code || null;
        setRetryError(getSingleTradeErrorMessage({ data: retryRes.data }, "Retry failed."));
        if (PERMANENT_RETRY_ERRORS.has(code)) setRetryBlocked(true);
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
        const code = result.code || null;
        setRetryError(getSingleTradeErrorMessage({ data: result }, "Analysis failed."));
        if (PERMANENT_RETRY_ERRORS.has(code)) setRetryBlocked(true);
        setStatus("notfound");
        setError(result.error);
        return;
      }
      if (result?.court_recess) {
        setRetryError(getSingleTradeErrorMessage({ data: { court_recess: true } }, "The court is in recess. Please try again shortly."));
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
      const apiErr = extractApiError(e, "Retry failed. Please try again.");
      setRetryError(getSingleTradeErrorMessage(e, "Retry failed. Please try again."));
      if (PERMANENT_RETRY_ERRORS.has(apiErr.code)) setRetryBlocked(true);
      setStatus("notfound");
    } finally {
      retryingRef.current = false;
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
  // Show the admin Retry Analysis button only when ALL of these hold:
  //  - access resolved (not loading, no error)
  //  - the user is an admin (server-authoritative, not client-inferred)
  //  - can_access is true (public_enabled || is_admin)
  //  - Single Trade usage is enabled and emergency stop is off
  //  - the case fetch resolved as notfound (unavailable case)
  const canAdminRetry = !accessLoading
    && !!access
    && access.is_admin
    && access.can_access
    && access.usage_enabled
    && !access.emergency_stop
    && status === "notfound";

  return (
    <UnavailableCase
      message={error || "This trade case was not completed and is unavailable."}
      showRetry={status === "error"}
      onRetry={handleRetryLoad}
      onBack={() => navigate("/")}
      showAdminRetry={canAdminRetry}
      adminRetrying={retrying}
      adminRetryBlocked={retryBlocked}
      adminRetryError={retryError}
      onAdminRetry={handleAdminRetry}
    />
  );
}

function UnavailableCase({ message, showRetry, onRetry, onBack, showAdminRetry, adminRetrying, adminRetryBlocked, adminRetryError, onAdminRetry }) {
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
          {message || "This trade case was not completed and is unavailable."}
        </p>

        {showAdminRetry && (
          <div className="mb-6 border-2 border-court-chart/60 bg-court-uv/30 p-4">
            <p className="font-mono text-sm text-court-chart mb-3 leading-relaxed">
              Retry using the original verified purchase details. No new discovery call required.
            </p>
            <button
              onClick={onAdminRetry}
              disabled={adminRetrying || adminRetryBlocked}
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