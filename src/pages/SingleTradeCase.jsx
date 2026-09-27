import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import SingleTradeVerdict from "@/components/walletcourt/SingleTradeVerdict";
import LoadingStage from "@/components/walletcourt/LoadingStage";
import { classifyCaseFetchResult } from "@/lib/routeState";
import { extractApiError } from "@/lib/apiError";
import { isSingleTradeRenderable } from "@/lib/singleTradeRenderable";
import { useVerdictScrollReset } from "@/hooks/useVerdictScrollReset";
import { RefreshCw, Loader2 } from "lucide-react";

// Extract the HTTP status and backend error message from any Base44 SDK
// error shape. Classifies the result so a backend 404 (non-renderable trial)
// enters the "notfound" state — NOT the transient "error" state. Only
// network errors, timeouts, and 5xx responses enter "error".
function classifyFetchError(e) {
  const apiErr = extractApiError(e, "The court couldn't load this case. Try again.");
  const rawStatus = apiErr.status ?? e?.status ?? e?.data?.status ?? e?.response?.status ?? null;
  const status = rawStatus != null ? Number(rawStatus) : null;
  const classified = classifyCaseFetchResult({ error: apiErr.message }, status);
  return { message: apiErr.message, status, classified };
}

export default function SingleTradeCase() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [trial, setTrial] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

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

  // Scroll to top when the verdict is first displayed (loading → done), and
  // when navigating between different case slugs. Does not scroll on rerenders
  // of the same case (e.g. refresh), so the user can read/scroll freely.
  useVerdictScrollReset(status === "done" && trial ? trial.public_slug : null);

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
      message={error || "This trade case was not completed and is unavailable."}
      showRetry={status === "error"}
      onRetry={() => setStatus("loading")}
      onBack={() => navigate("/")}
    />
  );
}

function UnavailableCase({ message, showRetry, onRetry, onBack }) {
  // noindex so search engines do not index unavailable cases.
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