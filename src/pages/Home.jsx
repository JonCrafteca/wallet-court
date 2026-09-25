import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
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
import { Wallet, Coins, Clock } from "lucide-react";

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
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    captureReferral();
    // Fetch public feature flags to filter the network selector. Robinhood
    // is hidden from public visitors when robinhood_public_enabled is false.
    getPublicFeatureFlags().then((flags) => {
      if (!flags?.robinhood_public_enabled) {
        setNetworks(ALL_NETWORKS.filter((n) => n.id !== "robinhood"));
      }
      setSingleTradeEnabled(!!flags?.single_trade_public_enabled);
    });
    // Check admin status for Single Trade admin testing.
    base44.auth.me().then((u) => { if (u?.role === "admin") setIsAdmin(true); }).catch(() => {});
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

  // Single Trade Trial mode — show "Coming Soon" when the flag is false and
  // the user is not an admin. Admins can test while the flag is false.
  if (trialMode === "single_trade") {
    return (
      <div className="relative">
        <ModeToggle trialMode={trialMode} setTrialMode={setTrialMode} />
        {singleTradeEnabled || isAdmin ? (
          <SingleTradeIntake onReset={() => setTrialMode("wallet")} />
        ) : (
          <SingleTradeComingSoon />
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