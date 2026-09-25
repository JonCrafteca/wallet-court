import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import VerdictReveal from "@/components/walletcourt/VerdictReveal";
import LoadingStage from "@/components/walletcourt/LoadingStage";
import { classifyCaseFetchResult } from "@/lib/routeState";
import { RefreshCw, Loader2 } from "lucide-react";

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
          setTrial(result.trial);
          setStatus("done");
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

  async function handleRetry() {
    setError("");
    setStatus("loading");
    try {
      const res = await base44.functions.invoke("getSingleTradeBySlug", { slug });
      const result = res?.data;
      const classified = classifyCaseFetchResult(result, res?.status);
      if (classified === "done") {
        setTrial(result.trial);
        setStatus("done");
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

  if (status === "loading") return <LoadingStage visible />;
  if (status === "done" && trial) {
    return (
      <div className="relative">
        <VerdictReveal trial={trial} onReset={() => navigate("/")} />
        {trial.case_outcome === "verdict" && (
          <div className="mx-auto max-w-3xl px-4 pb-12 -mt-4">
            <RefreshButton slug={trial.public_slug} onRefreshed={(updated) => setTrial(updated)} />
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-xl px-4 pt-20 pb-24">
      <div className="border-2 border-court-red bg-court-navy p-6 sm:p-8 text-center">
        <p className="font-display uppercase text-court-red text-3xl mb-3 tracking-[0.04em]">
          {status === "notfound" ? "Case file not found" : "Court Recess"}
        </p>
        <p className="font-mono text-base text-court-ice mb-6 leading-relaxed">
          {error || "This trade case never made it to the docket."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {status === "error" && (
            <button
              onClick={handleRetry}
              className="inline-flex items-center justify-center bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
            >
              Retry
            </button>
          )}
          <button
            onClick={() => navigate("/")}
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