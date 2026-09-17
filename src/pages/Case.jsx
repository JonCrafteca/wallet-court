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
      <div className="mx-auto max-w-xl px-4 pt-24 text-center">
        <p className="font-display font-bold uppercase text-court-gold text-2xl mb-3">
          Case file not found
        </p>
        <p className="text-sm text-muted-foreground mb-6">
          {error || "This case never made it to the docket."}
        </p>
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center justify-center bg-court-gold text-court-bg font-display font-bold uppercase tracking-[0.18em] text-sm px-6 py-3"
        >
          New Trial
        </button>
      </div>
    );
  }
  return <VerdictReveal trial={trial} onReset={() => navigate("/")} />;
}