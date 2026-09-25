import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Gavel, AlertTriangle, Search, Loader2, ArrowLeft, Coins } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateWalletForChain } from "@/lib/walletValidation";
import VerdictReveal from "./VerdictReveal";
import LoadingStage from "./LoadingStage";
import CourtRecess from "./CourtRecess";

export default function SingleTradeIntake({ onReset }) {
  const [network] = useState("solana");
  const [address, setAddress] = useState("");
  const [tokenMint, setTokenMint] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [error, setError] = useState("");
  const [phase, setPhase] = useState("intake"); // intake | discovering | select | analyzing | done | recess
  const [purchases, setPurchases] = useState([]);
  const [selectedSelection, setSelectedSelection] = useState(null);
  const [trial, setTrial] = useState(null);
  const [recess, setRecess] = useState(null);

  async function handleDiscover(e) {
    e.preventDefault();
    setError("");
    if (!address.trim()) { setError("A wallet address is required."); return; }
    if (!tokenMint.trim()) { setError("A token mint address is required."); return; }
    const validation = validateWalletForChain(network, address.trim());
    if (!validation.ok) { setError(validation.message); return; }
    setPhase("discovering");
    try {
      const [res] = await Promise.all([
        base44.functions.invoke("discoverTokenPurchases", {
          wallet_address: address.trim(),
          network,
          token_mint: tokenMint.trim(),
        }),
        new Promise((r) => setTimeout(r, 1800)),
      ]);
      if (res?.data?.error) { setError(res.data.error); setPhase("intake"); return; }
      if (res?.data?.court_recess) { setRecess(res.data); setPhase("recess"); return; }
      if (!res?.data?.purchases || res.data.purchases.length === 0) {
        setError("No purchases of this token were found for this wallet.");
        setPhase("intake");
        return;
      }
      setPurchases(res.data.purchases);
      setSelectedSelection(null);
      setPhase("select");
    } catch (e) {
      setError(e?.message || "Discovery failed. Try again.");
      setPhase("intake");
    }
  }

  async function handleAnalyze() {
    setError("");
    if (!selectedSelection) { setError("Select a purchase to put on trial."); return; }
    setPhase("analyzing");
    try {
      const [res] = await Promise.all([
        base44.functions.invoke("analyzeSingleTrade", {
          wallet_address: address.trim(),
          network,
          token_mint: tokenMint.trim(),
          selection_token: selectedSelection,
        }),
        new Promise((r) => setTimeout(r, 2800)),
      ]);
      if (res?.data?.error) { setError(res.data.error); setPhase("select"); return; }
      if (res?.data?.court_recess) { setRecess(res.data); setPhase("recess"); return; }
      setTrial(res.data.trial);
      setPhase("done");
    } catch (e) {
      setError(e?.message || "Analysis failed. Try again.");
      setPhase("select");
    }
  }

  function handleFullReset() {
    setPhase("intake");
    setTrial(null);
    setRecess(null);
    setPurchases([]);
    setSelectedSelection(null);
    setError("");
    if (onReset) onReset();
  }

  if (phase === "done" && trial) {
    return <VerdictReveal trial={trial} onReset={handleFullReset} />;
  }

  if (phase === "recess" && recess) {
    return (
      <CourtRecess
        recessType={recess.recess_type}
        retryAfter={recess.retry_after}
        onRetry={() => { setRecess(null); setPhase("intake"); }}
        onReset={handleFullReset}
      />
    );
  }

  return (
    <section className="mx-auto max-w-3xl px-4 pt-10 sm:pt-16 pb-24">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 border-2 border-court-chart bg-court-navy px-3 py-1 mb-4">
          <Coins className="h-4 w-4 text-court-chart" />
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-court-chart">Single Trade Trial · Solana</span>
        </div>
        <h1 className="font-display uppercase leading-[0.84] text-court-ice" style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)" }}>
          Put One Trade<br className="hidden sm:block" /> on Trial
        </h1>
        <p className="mt-4 font-mono text-base text-court-ice max-w-xl mx-auto leading-relaxed">
          Don't judge the whole wallet. Judge the one trade that matters.
        </p>
      </div>

      <form onSubmit={handleDiscover}>
        <div className="border-4 border-court-ice bg-court-navy shadow-[8px_8px_0_0_#5127C7]">
          <div className="flex items-center justify-between border-b-2 border-court-ice bg-court-red px-4 py-2">
            <span className="font-display uppercase tracking-[0.1em] text-court-ice text-sm">
              Trade Docket · Single Purchase Division
            </span>
          </div>

          <div className="p-5 sm:p-7 space-y-5">
            {/* Network (Solana only) */}
            <div>
              <label className="block font-mono text-xs uppercase tracking-[0.16em] text-court-mute mb-2">
                Select Network
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button type="button" className="border-2 px-3 py-3 font-display uppercase tracking-[0.06em] text-sm bg-court-chart text-court-navy border-court-chart shadow-[3px_3px_0_0_#FF3B30]">
                  Solana
                </button>
                <button type="button" disabled className="border-2 px-3 py-3 font-display uppercase tracking-[0.06em] text-sm bg-court-navy text-court-mute/50 border-court-mute/30 cursor-not-allowed">
                  Ethereum
                </button>
                <button type="button" disabled className="border-2 px-3 py-3 font-display uppercase tracking-[0.06em] text-sm bg-court-navy text-court-mute/50 border-court-mute/30 cursor-not-allowed">
                  Base
                </button>
              </div>
              <p className="mt-1.5 font-mono text-xs text-court-mute/70">Ethereum and Base coming soon.</p>
            </div>

            {/* Wallet address */}
            <div>
              <label htmlFor="st-wallet" className="block font-mono text-xs uppercase tracking-[0.16em] text-court-mute mb-2">
                Wallet Address
              </label>
              <div className="flex items-center border-2 border-court-ice bg-court-navy focus-within:border-court-chart transition-colors">
                <span className="px-3 text-court-red font-mono text-base select-none border-r border-court-mute">№</span>
                <input
                  id="st-wallet"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="enter the wallet address…"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full bg-transparent py-3 pr-3 font-mono text-base text-court-ice placeholder:text-court-mute focus:outline-none"
                />
              </div>
            </div>

            {/* Token mint */}
            <div>
              <label htmlFor="st-mint" className="block font-mono text-xs uppercase tracking-[0.16em] text-court-mute mb-2">
                Token Mint Address
              </label>
              <div className="flex items-center border-2 border-court-ice bg-court-navy focus-within:border-court-chart transition-colors">
                <span className="px-3 text-court-chart font-mono text-base select-none border-r border-court-mute">◎</span>
                <input
                  id="st-mint"
                  type="text"
                  value={tokenMint}
                  onChange={(e) => setTokenMint(e.target.value)}
                  placeholder="enter the token mint address…"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full bg-transparent py-3 pr-3 font-mono text-base text-court-ice placeholder:text-court-mute focus:outline-none"
                />
              </div>
              <input
                type="text"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                placeholder="token symbol (optional, e.g. JEANPHIL)"
                spellCheck={false}
                autoComplete="off"
                maxLength={20}
                className="mt-2 w-full border-2 border-court-mute/40 bg-court-navy px-3 py-2 font-mono text-sm text-court-ice placeholder:text-court-mute/60 focus:outline-none focus:border-court-chart"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-3 text-base text-court-red">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="font-mono leading-relaxed">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={phase === "discovering"}
              className="group w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-lg py-4 border-2 border-court-navy shadow-[5px_5px_0_0_#FF3B30] hover:shadow-none hover:translate-x-[5px] hover:translate-y-[5px] transition-all disabled:opacity-60"
            >
              {phase === "discovering" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              Find Purchases
            </button>
          </div>
        </div>
      </form>

      {/* Purchase list */}
      {phase === "select" && purchases.length > 0 && (
        <div className="mt-6 border-2 border-court-uv bg-court-navy">
          <div className="border-b-2 border-court-uv px-4 py-3">
            <h2 className="font-display uppercase tracking-[0.08em] text-court-chart text-lg">
              {purchases.length} Purchase{purchases.length !== 1 ? "s" : ""} Found
            </h2>
            <p className="font-mono text-xs text-court-mute mt-0.5">Select the trade to put on trial.</p>
          </div>
          <div className="divide-y-2 divide-court-mute/20">
            {purchases.map((p, i) => (
              <label
                key={p.transaction_hash}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors",
                  selectedSelection === p.selection_id ? "bg-court-chart/10" : "hover:bg-court-uv/30"
                )}
              >
                <input
                  type="radio"
                  name="purchase"
                  value={p.selection_id}
                  checked={selectedSelection === p.selection_id}
                  onChange={(e) => setSelectedSelection(e.target.value)}
                  className="h-5 w-5 accent-court-chart shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-mono text-sm text-court-ice font-semibold">
                      {new Date(p.block_timestamp).toLocaleString()}
                    </span>
                    {p.entry_market_cap_usd != null && (
                      <span className="font-mono text-xs text-court-mute">
                        Entry mcap: ${(p.entry_market_cap_usd / 1e6).toFixed(2)}M
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 mt-0.5">
                    {p.purchase_cost_usd != null && (
                      <span className="font-mono text-xs text-court-chart">
                        Cost: ${p.purchase_cost_usd.toFixed(2)}
                      </span>
                    )}
                    {p.tokens_received != null && (
                      <span className="font-mono text-xs text-court-mute">
                        Tokens: {Math.round(p.tokens_received).toLocaleString()}
                      </span>
                    )}
                    <span className="font-mono text-xs text-court-mute/70 truncate">
                      tx: {p.transaction_hash_short}
                    </span>
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div className="p-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleAnalyze}
              disabled={!selectedSelection || phase === "analyzing"}
              className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50"
            >
              {phase === "analyzing" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Gavel className="h-5 w-5" />}
              Put This Trade on Trial
            </button>
            <button
              type="button"
              onClick={() => { setPhase("intake"); setPurchases([]); setSelectedSelection(null); setError(""); }}
              className="inline-flex items-center gap-2 border-2 border-court-ice text-court-ice font-display uppercase tracking-[0.1em] text-sm px-4 py-3 hover:bg-court-uv transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
          </div>
        </div>
      )}

      <LoadingStage visible={phase === "discovering" || phase === "analyzing"} />

      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={handleFullReset}
          className="font-mono text-sm text-court-mute hover:text-court-ice transition-colors"
        >
          ← Back to Wallet Court
        </button>
      </div>
    </section>
  );
}