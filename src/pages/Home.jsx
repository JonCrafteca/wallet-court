import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { captureReferral, getAttributionContext } from "@/lib/attribution";
import IntakeStage from "@/components/walletcourt/IntakeStage";
import LoadingStage from "@/components/walletcourt/LoadingStage";
import VerdictReveal from "@/components/walletcourt/VerdictReveal";
import CourtRecess from "@/components/walletcourt/CourtRecess";
import { validateWalletForChain } from "@/lib/walletValidation";
import { NETWORK_OPTIONS as NETWORKS } from "@/lib/chains";

export default function Home() {
  const [network, setNetwork] = useState("ethereum");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | recess
  const [trial, setTrial] = useState(null);
  const [recess, setRecess] = useState(null);
  const [subjectType, setSubjectType] = useState("anonymous");
  const [proposedHandle, setProposedHandle] = useState("");

  useEffect(() => { captureReferral(); }, []);

  async function runAnalysis(addr, net) {
    const ctx = getAttributionContext();
    const [res] = await Promise.all([
      base44.functions.invoke("analyzeWalletWithNansen", {
        wallet_address: addr,
        network: net,
        ref_code: ctx.ref_code,
        visitor_id: ctx.visitor_id,
      }),
      new Promise((r) => setTimeout(r, 2800)),
    ]);
    if (res?.data?.error) {
      throw new Error(res.data.error);
    }
    return res;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!address.trim()) {
      setError("A wallet address is required for the summons.");
      return;
    }
    // Frontend validation: immediate feedback before any request. The backend
    // is authoritative, but this prevents a round-trip for obvious mismatches
    // (e.g. an EVM 0x address with Solana selected).
    const validation = validateWalletForChain(network, address.trim());
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setStatus("loading");
    setRecess(null);
    try {
      const res = await runAnalysis(address.trim(), network);
      if (res?.data?.court_recess) {
        setRecess(res.data);
        setStatus("recess");
        return;
      }
      setTrial(res.data.trial);
      setStatus("done");
    } catch (err) {
      setError(err?.message || "The court failed to convene. Try again.");
      setStatus("idle");
    }
  }

  async function handleRetry() {
    // Re-submit the same wallet after a Court Recess.
    setError("");
    if (!address.trim()) {
      setStatus("idle");
      return;
    }
    setStatus("loading");
    setRecess(null);
    try {
      const res = await runAnalysis(address.trim(), network);
      if (res?.data?.court_recess) {
        setRecess(res.data);
        setStatus("recess");
        return;
      }
      setTrial(res.data.trial);
      setStatus("done");
    } catch (err) {
      setError(err?.message || "The court failed to convene. Try again.");
      setStatus("idle");
    }
  }

  function handleReset() {
    setStatus("idle");
    setTrial(null);
    setRecess(null);
    setAddress("");
    setError("");
  }

  if (status === "done" && trial) {
    return <VerdictReveal trial={trial} onReset={handleReset} subjectType={subjectType} proposedHandle={proposedHandle} />;
  }

  if (status === "recess" && recess) {
    return (
      <CourtRecess
        recessType={recess.recess_type}
        retryAfter={recess.retry_after}
        onRetry={handleRetry}
        onReset={handleReset}
      />
    );
  }

  return (
    <div className="relative">
      <IntakeStage
        network={network}
        setNetwork={setNetwork}
        networks={NETWORKS}
        address={address}
        setAddress={setAddress}
        onSubmit={handleSubmit}
        error={error}
        subjectType={subjectType}
        setSubjectType={setSubjectType}
        proposedHandle={proposedHandle}
        setProposedHandle={setProposedHandle}
      />
      <LoadingStage visible={status === "loading"} />
    </div>
  );
}