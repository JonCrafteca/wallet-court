import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import VerdictReveal from "@/components/walletcourt/VerdictReveal";
import LoadingStage from "@/components/walletcourt/LoadingStage";

export default function Case() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [trial, setTrial] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await base44.functions.invoke("getTrialBySlug", { slug });
        if (!alive) return;
        if (res?.data?.error) {
          setError(res.data.error);
          setStatus("notfound");
          return;
        }
        setTrial(res.data.trial);
        setStatus("done");
      } catch (e) {
        setError(e?.message || "Case file missing.");
        setStatus("notfound");
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug]);

  if (status === "loading") return <LoadingStage visible />;
  if (status !== "done" || !trial) {
    return (
      <div className="mx-auto max-w-xl px-4 pt-20 pb-24">
        <div className="border-2 border-court-ice bg-court-navy p-6 sm:p-8 text-center">
          <p className="font-display uppercase text-court-red text-3xl mb-3 tracking-[0.04em]">
            Case file not found
          </p>
          <p className="font-mono text-base text-court-ice mb-6 leading-relaxed">
            {error || "This case never made it to the docket."}
          </p>
          <button
            onClick={() => navigate("/")}
            className="inline-flex items-center justify-center bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
          >
            Roast Another Wallet
          </button>
        </div>
      </div>
    );
  }
  return <VerdictReveal trial={trial} onReset={() => navigate("/")} />;
}