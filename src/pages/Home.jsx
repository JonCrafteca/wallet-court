import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { captureReferral, getAttributionContext } from "@/lib/attribution";
import IntakeStage from "@/components/walletcourt/IntakeStage";
import SingleTradeIntake from "@/components/walletcourt/SingleTradeIntake";
import LoadingStage from "@/components/walletcourt/LoadingStage";
import VerdictReveal from "@/components/walletcourt/VerdictReveal";
import CourtRecess from "@/components/walletcourt/CourtRecess";
import { validateWalletForChain } from "@/lib/walletValidation";
import { NETWORK_OPTIONS as ALL_NETWORKS } from "@/lib/chains";
import { getPublicFeatureFlags } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";
import { Wallet, Coins, Clock, ShieldAlert } from "lucide-react";

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
  const [singleTradeEnabled, setSingleTradeEnabled] = useState(false);
  const [flagsLoaded, setFlagsLoaded] = useState(false);
  // Admin status comes from the server-backed AuthContext user — never from
  // URL params, local storage, or client-controlled values.
  const { user, isLoadingAuth } = useAuth();
  const isAdmin = !!user && user.role === "admin";

  useEffect(() => {
    captureReferral();
    // Fetch public feature flags to filter the network selector. Robinhood
    // is hidden from public visitors when robinhood_public_enabled is false.
    getPublicFeatureFlags().then((flags) => {
      if (!flags?.robinhood_public_enabled) {
        setNetworks(ALL_NETWORKS.filter((n) => n.id !== "robinhood"));
      }
      setSingleTradeEnabled(!!flags?.single_trade_public_enabled);
    }).finally(() => setFlagsLoaded(true));
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

  // Single Trade Trial mode — gated by the public feature flag OR server-backed
  // admin role. While auth or flags are still loading, default safely to Coming
  // Soon so no Nansen calls can occur before access is confirmed.
  if (trialMode === "single_trade") {
    const canAccess = singleTradeEnabled || isAdmin;
    const showAdminPreview = isAdmin && !singleTradeEnabled;
    return (
      <div className="relative">
        <ModeToggle trialMode={trialMode} setTrialMode={setTrialMode} />
        {isLoadingAuth || !flagsLoaded || !canAccess ? (
          <SingleTradeComingSoon />
        ) : (
          <>
            {showAdminPreview && <AdminPreviewLabel />}
            <SingleTradeIntake onReset={() => setTrialMode("wallet")} />
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