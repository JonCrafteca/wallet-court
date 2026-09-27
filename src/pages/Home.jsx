import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { captureReferral, getAttributionContext } from "@/lib/attribution";
import IntakeStage from "@/components/walletcourt/IntakeStage";
import SingleTradeIntake from "@/components/walletcourt/SingleTradeIntake";
import LoadingStage from "@/components/walletcourt/LoadingStage";
import VerdictReveal from "@/components/walletcourt/VerdictReveal";
import CourtRecess from "@/components/walletcourt/CourtRecess";
import { validateWalletForChain } from "@/lib/walletValidation";
import { extractAnalysisError } from "@/lib/apiError";
import { NETWORK_OPTIONS as ALL_NETWORKS } from "@/lib/chains";
import { getPublicFeatureFlags } from "@/lib/featureFlags";
import { getSingleTradeAccess } from "@/lib/singleTradeAccess";
import { cn } from "@/lib/utils";
import { Wallet, Coins, Clock, ShieldAlert, OctagonAlert } from "lucide-react";

export default function Home() {
  const [trialMode, setTrialMode] = useState("wallet"); // wallet | single_trade
  const [network, setNetwork] = useState("ethereum");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done | recess
  const [trial, setTrial] = useState(null);
  const [recess, setRecess] = useState(null);
  const [subjectType, setSubjectType] = useState("anonymous");
  const [proposedHandle, setProposedHandle] = useState("");
  const [networks, setNetworks] = useState(ALL_NETWORKS);
  // Single Trade access is resolved server-side by getSingleTradeAccess,
  // which uses the canonical admin check (base44.auth.me + role === "admin").
  // Never inferred from client user fields, routes, query strings, or UI state.
  const [access, setAccess] = useState(null); // null = loading / fail-closed
  const [accessLoaded, setAccessLoaded] = useState(false);

  useEffect(() => {
    captureReferral();
    // Fetch public feature flags to filter the network selector. Robinhood
    // is hidden from public visitors when robinhood_public_enabled is false.
    getPublicFeatureFlags().then((flags) => {
      if (!flags?.robinhood_public_enabled) {
        setNetworks(ALL_NETWORKS.filter((n) => n.id !== "robinhood"));
      }
    });
    // Fetch the authoritative Single Trade access decision from the backend.
    // On rejection, access stays null → fail closed to Coming Soon.
    getSingleTradeAccess().then((a) => setAccess(a)).catch(() => {}).finally(() => setAccessLoaded(true));
  }, []);

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
    // On a 2xx body that still carries an error/court_recess, throw a synthetic
    // error that mirrors the axios shape so the catch block's extractAnalysisError
    // can read the structured payload (court_recess, error, code) uniformly.
    if (res?.data?.error || res?.data?.court_recess) {
      const synth = new Error(res.data.error || "The court failed to convene.");
      synth.response = { data: res.data, status: res?.status ?? null };
      throw synth;
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
      const result = extractAnalysisError(err);
      if (result.kind === "recess") {
        setRecess(result.recess);
        setStatus("recess");
        return;
      }
      setError(result.message);
      setStatus("idle");
    }
  }

  async function handleRetry() {
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
      const result = extractAnalysisError(err);
      if (result.kind === "recess") {
        setRecess(result.recess);
        setStatus("recess");
        return;
      }
      setError(result.message);
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
        reason={recess.sanitized_reason}
        onRetry={handleRetry}
        onReset={handleReset}
      />
    );
  }

  // Single Trade Trial mode — access is the authoritative decision from
  // getSingleTradeAccess (server-side canonical admin check). While loading
  // or on failure, fail closed to Coming Soon so no Nansen calls can occur
  // before access is confirmed.
  if (trialMode === "single_trade") {
    const canAccess = !!(access && access.can_access);
    const showAdminPreview = !!(access && access.admin_preview);
    const usageBlocked = !!(access && (!access.usage_enabled || access.emergency_stop));
    return (
      <div className="relative">
        <ModeToggle trialMode={trialMode} setTrialMode={setTrialMode} />
        {!accessLoaded || !canAccess ? (
          <SingleTradeComingSoon />
        ) : (
          <>
            {showAdminPreview && <AdminPreviewLabel />}
            {usageBlocked ? (
              <SingleTradeBlocked emergencyStop={access.emergency_stop} usageEnabled={access.usage_enabled} />
            ) : (
              <SingleTradeIntake onReset={() => setTrialMode("wallet")} />
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <ModeToggle trialMode={trialMode} setTrialMode={setTrialMode} />
      <IntakeStage
        network={network}
        setNetwork={setNetwork}
        networks={networks}
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

function SingleTradeComingSoon() {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-10 sm:pt-16 pb-24">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 border-2 border-court-chart bg-court-navy px-3 py-1 mb-4">
          <Coins className="h-4 w-4 text-court-chart" />
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-court-chart">Single Trade Trial · Solana</span>
        </div>
        <h1 className="font-display uppercase leading-[0.84] text-court-ice" style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)" }}>
          Coming Soon
        </h1>
        <p className="mt-4 font-mono text-base text-court-ice max-w-xl mx-auto leading-relaxed">
          Single Trade Trial is almost ready. You'll soon be able to put one specific token purchase on trial — entry, drawdown, conviction, and all.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 border-2 border-court-mute/40 bg-court-navy/60 px-4 py-2">
          <Clock className="h-4 w-4 text-court-chart animate-blink" />
          <span className="font-mono text-sm text-court-mute">Stay tuned — launch imminent.</span>
        </div>
      </div>
    </section>
  );
}

function AdminPreviewLabel() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-4">
      <div className="flex items-center justify-center gap-2 border-2 border-court-red bg-court-navy px-4 py-2 shadow-[4px_4px_0_0_#5127C7]">
        <ShieldAlert className="h-4 w-4 text-court-red shrink-0" />
        <span className="font-mono text-xs uppercase tracking-[0.18em] text-court-red font-semibold">
          Admin Preview · Public Disabled
        </span>
      </div>
    </div>
  );
}

function SingleTradeBlocked({ emergencyStop, usageEnabled }) {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-10 sm:pt-16 pb-24">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 border-2 border-court-red bg-court-navy px-3 py-1 mb-4">
          <OctagonAlert className="h-4 w-4 text-court-red" />
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-court-red">
            Single Trade Trial · {emergencyStop ? "Emergency Stop" : "Disabled"}
          </span>
        </div>
        <h1 className="font-display uppercase leading-[0.84] text-court-ice" style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)" }}>
          {emergencyStop ? "Court Halted" : "Trial Paused"}
        </h1>
        <p className="mt-4 font-mono text-base text-court-ice max-w-xl mx-auto leading-relaxed">
          {emergencyStop
            ? "An emergency stop is active. Single Trade Trial is halted until an administrator clears it. No analysis calls can be made."
            : "Single Trade Trial usage is currently disabled. An administrator must enable it before any analysis calls can be made."}
        </p>
      </div>
    </section>
  );
}

function ModeToggle({ trialMode, setTrialMode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 flex gap-2 justify-center">
      <button
        type="button"
        onClick={() => setTrialMode("wallet")}
        className={cn(
          "inline-flex items-center gap-2 px-4 py-2 border-2 font-display uppercase tracking-[0.08em] text-sm transition-all",
          trialMode === "wallet"
            ? "bg-court-chart text-court-navy border-court-chart shadow-[3px_3px_0_0_#FF3B30]"
            : "bg-court-navy text-court-ice border-court-mute/40 hover:border-court-ice"
        )}
      >
        <Wallet className="h-4 w-4" /> Whole Wallet
      </button>
      <button
        type="button"
        onClick={() => setTrialMode("single_trade")}
        className={cn(
          "inline-flex items-center gap-2 px-4 py-2 border-2 font-display uppercase tracking-[0.08em] text-sm transition-all",
          trialMode === "single_trade"
            ? "bg-court-chart text-court-navy border-court-chart shadow-[3px_3px_0_0_#FF3B30]"
            : "bg-court-navy text-court-ice border-court-mute/40 hover:border-court-ice"
        )}
      >
        <Coins className="h-4 w-4" /> Single Trade
      </button>
    </div>
  );
}