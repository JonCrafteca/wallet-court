import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { getRapSheet } from "@/lib/walletClaim";
import { trackClaim, CLAIM_EVENTS } from "@/lib/claimAnalytics";
import RapSheet from "@/components/walletcourt/RapSheet";
import LoadingStage from "@/components/walletcourt/LoadingStage";

export default function Wallet() {
  const { claimSlug } = useParams();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [reloadKey, setReloadKey] = useState(0);

  const reload = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await getRapSheet(claimSlug);
      if (!alive) return;
      if (d?.error) { setStatus("notfound"); return; }
      if (d?.sealed) { setData(d); setStatus("sealed"); return; }
      setData(d);
      setStatus("done");
      trackClaim(CLAIM_EVENTS.RAP_SHEET_VIEWED, { visibility: d.profile_visibility });
    })();
    return () => { alive = false; };
  }, [claimSlug, reloadKey]);

  if (status === "loading") return <LoadingStage visible />;

  if (status === "notfound") {
    return (
      <div className="mx-auto max-w-xl px-4 pt-20 pb-24 text-center">
        <p className="font-display uppercase text-court-red text-3xl mb-3 tracking-[0.04em]">Rap Sheet not found</p>
        <p className="font-mono text-base text-court-mute mb-6">No court record exists at this address.</p>
        <Link to="/" className="inline-flex items-center justify-center bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy">Back to Court</Link>
      </div>
    );
  }

  if (status === "sealed") {
    return (
      <div className="mx-auto max-w-xl px-4 pt-20 pb-24 text-center">
        <p className="font-display uppercase text-court-ice text-3xl mb-3 tracking-[0.04em]">This court record is sealed.</p>
        <p className="font-mono text-base text-court-mute mb-6">The owner has kept this Rap Sheet private.</p>
        <Link to="/" className="inline-flex items-center justify-center bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy">Back to Court</Link>
      </div>
    );
  }

  return <RapSheet data={data} claimSlug={claimSlug} onReload={reload} />;
}