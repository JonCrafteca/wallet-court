import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Loader2, Play, Square, Plus, ChevronRight,
  Check, X, Activity, Zap, RefreshCw, ToggleLeft, ToggleRight
} from "lucide-react";

export default function AdminRobinhoodValidation() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [walletInput, setWalletInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [togglingFlag, setTogglingFlag] = useState(false);
  const [actionError, setActionError] = useState("");
  const [lastResult, setLastResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await base44.functions.invoke("getRobinhoodValidationStatus", {});
      if (res?.data?.error) {
        setError(res.data.error);
      } else {
        setData(res.data);
      }
    } catch (e) {
      setError(e?.message || "Failed to load validation status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try { setUser(await base44.auth.me()); } catch { setUser(null); } finally { setAuthChecked(true); }
    })();
    load();
  }, [load]);

  async function handleAddWallet(e) {
    e?.preventDefault();
    if (!walletInput.trim()) return;
    setSubmitting(true);
    setActionError("");
    try {
      const res = await base44.functions.invoke("submitRobinhoodValidationWallet", {
        wallet_address: walletInput.trim()
      });
      if (res?.data?.error) {
        setActionError(res.data.error);
      } else {
        setWalletInput("");
        await load();
      }
    } catch (e) {
      setActionError(e?.message || "Failed to add wallet.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStart() {
    setActionError("");
    try {
      const res = await base44.functions.invoke("startRobinhoodValidation", {});
      if (res?.data?.error) setActionError(res.data.error);
      await load();
    } catch (e) {
      setActionError(e?.message || "Failed to start validation.");
    }
  }

  async function handleAdvance() {
    setAdvancing(true);
    setActionError("");
    setLastResult(null);
    try {
      const res = await base44.functions.invoke("advanceRobinhoodValidation", {});
      if (res?.data?.error) {
        setActionError(res.data.error);
      } else {
        setLastResult(res.data);
      }
      await load();
    } catch (e) {
      setActionError(e?.message || "Wallet processing failed.");
    } finally {
      setAdvancing(false);
    }
  }

  async function handleStop() {
    setStopping(true);
    setActionError("");
    try {
      const res = await base44.functions.invoke("stopRobinhoodValidation", {});
      if (res?.data?.error) setActionError(res.data.error);
      await load();
    } catch (e) {
      setActionError(e?.message || "Failed to stop validation.");
    } finally {
      setStopping(false);
    }
  }

  async function handleToggleFlag(enabled) {
    setTogglingFlag(true);
    setActionError("");
    try {
      const res = await base44.functions.invoke("setRobinhoodPublicEnabled", {
        robinhood_public_enabled: enabled
      });
      if (res?.data?.error) setActionError(res.data.error);
      await load();
    } catch (e) {
      setActionError(e?.message || "Failed to toggle feature flag.");
    } finally {
      setTogglingFlag(false);
    }
  }

  if (!authChecked || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-court-chart" />
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <AlertTriangle className="h-10 w-10 text-court-red mx-auto mb-4" />
        <p className="font-display uppercase tracking-[0.06em] text-court-red text-xl mb-2">Admin Access Required</p>
        <p className="font-mono text-sm text-court-ice mb-6">This page is restricted to administrators.</p>
        <Link to="/" className="font-display uppercase tracking-[0.08em] text-court-chart hover:text-court-ice">Return to Courtroom</Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <AlertTriangle className="h-10 w-10 text-court-red mx-auto mb-4" />
        <p className="font-display uppercase tracking-[0.06em] text-court-red text-xl mb-2">Status Unavailable</p>
        <p className="font-mono text-sm text-court-ice mb-6">{error}</p>
        <button onClick={load} className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy">
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  const allowance = data?.allowance || {};
  const wallets = data?.wallets || [];
  const isRunning = allowance.status === "running";
  const canAdvance = isRunning && (allowance.remaining_attempts > 0) && (allowance.remaining_wallets > 0) && wallets.some(w => w.status === "pending");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-12 space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-4 border-court-chart pb-4">
        <div>
          <h1 className="font-display uppercase tracking-[0.04em] text-court-ice text-3xl sm:text-4xl flex items-center gap-2">
            <Zap className="h-7 w-7 text-court-chart" /> Robinhood Validation
          </h1>
          <p className="font-mono text-sm text-court-mute mt-1">Isolated 21-attempt / 5-wallet allowance · Does NOT touch the 1,000-call campaign</p>
        </div>
        <Link to="/admin/calibration-docket" className="inline-flex items-center gap-1.5 font-mono text-sm uppercase tracking-[0.12em] text-court-chart hover:text-court-ice transition-colors border-2 border-court-chart/40 px-3 py-1.5">
          <ChevronRight className="h-4 w-4 rotate-180" /> Calibration Docket
        </Link>
      </div>

      {actionError && (
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-3 text-sm text-court-red">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="font-mono leading-relaxed">{actionError}</span>
        </div>
      )}

      {/* Feature flag toggle */}
      <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5">
        <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg mb-3">Public Feature Flag</h2>
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => handleToggleFlag(!data?.allowance?.robinhood_public_enabled)}
            disabled={togglingFlag}
            className="inline-flex items-center gap-2 font-mono text-sm text-court-ice"
          >
            {data?.allowance?.robinhood_public_enabled ? (
              <ToggleRight className="h-8 w-8 text-court-chart" />
            ) : (
              <ToggleLeft className="h-8 w-8 text-court-mute" />
            )}
            <span className={data?.allowance?.robinhood_public_enabled ? "text-court-chart" : "text-court-mute"}>
              {data?.allowance?.robinhood_public_enabled ? "Robinhood PUBLIC: ENABLED" : "Robinhood PUBLIC: DISABLED"}
            </span>
          </button>
          <p className="font-mono text-xs text-court-mute leading-relaxed max-w-md">
            When disabled, public Robinhood wallet submissions are rejected before any Nansen call. Admin validation and calibration are unaffected.
          </p>
        </div>
      </div>

      {/* Allowance status */}
      <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5">
        <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg mb-4">Allowance Status</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Status" value={allowance.status || "not_started"} highlight={allowance.status === "running"} />
          <Stat label="Wallets" value={`${allowance.wallets_started || 0} / ${allowance.max_wallets || 5}`} sub={`${allowance.wallets_completed || 0} completed`} />
          <Stat label="Attempts" value={`${allowance.attempts_used || 0} / ${allowance.max_attempts || 21}`} sub={`${allowance.remaining_attempts ?? 21} remaining`} highlight={(allowance.remaining_attempts ?? 21) <= 5} />
          <Stat label="Global Total" value={data?.current_global_total ?? "—"} sub="verified Nansen calls" />
        </div>
        {allowance.stop_reason && (
          <p className="mt-3 font-mono text-sm text-court-red">{allowance.stop_reason}</p>
        )}
        {data?.circuit_open && (
          <div className="mt-3 border-2 border-court-red bg-court-red/10 px-3 py-2 font-mono text-sm text-court-red">
            ⚠ Nansen circuit is OPEN. All chains are blocked until recovery. {data.circuit_shared_warning}
          </div>
        )}
        {allowance.starting_global_total != null && (
          <p className="mt-3 font-mono text-xs text-court-mute">
            Started at global total {allowance.starting_global_total} · Current: {data?.current_global_total ?? "—"}
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="border-2 border-court-chart bg-court-navy p-4 sm:p-5">
        <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg mb-4">Validation Controls</h2>
        <div className="flex flex-wrap gap-3">
          {!isRunning ? (
            <button onClick={handleStart} disabled={submitting || stopping}
              className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[3px_3px_0_0_#FF3B30] disabled:opacity-60">
              <Play className="h-4 w-4" /> Start Validation
            </button>
          ) : (
            <button onClick={handleStop} disabled={stopping || advancing}
              className="inline-flex items-center gap-2 border-2 border-court-red text-court-red font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 hover:bg-court-red hover:text-court-ice disabled:opacity-60">
              {stopping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} Stop
            </button>
          )}
          <button onClick={handleAdvance} disabled={!canAdvance || advancing}
            className="inline-flex items-center gap-2 bg-court-uv text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-ice disabled:opacity-50">
            {advancing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />} Process Next Wallet
          </button>
          <button onClick={load} disabled={loading}
            className="inline-flex items-center gap-2 border-2 border-court-mute/40 text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 hover:border-court-ice disabled:opacity-60">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
          </button>
        </div>
        {!canAdvance && isRunning && (
          <p className="mt-3 font-mono text-xs text-court-mute">
            {allowance.remaining_attempts <= 0 ? "Allowance exhausted." : allowance.remaining_wallets <= 0 ? "All wallets processed." : "No pending wallets in queue."}
          </p>
        )}
        {lastResult && (
          <div className="mt-4 border-2 border-court-mute/40 p-3 font-mono text-sm text-court-ice">
            <p className="uppercase tracking-[0.1em] text-court-mute mb-2">Last Result</p>
            <div className="space-y-1">
              <p>Wallet: <span className="text-court-chart">{lastResult.address_short}</span></p>
              <p>Status: <span className={lastResult.status === "completed" ? "text-court-chart" : "text-court-red"}>{lastResult.status}</span></p>
              {lastResult.verdict_name && <p>Verdict: {lastResult.verdict_name}</p>}
              {lastResult.case_outcome && <p>Outcome: {lastResult.case_outcome}</p>}
              <p>Calls used: {lastResult.calls_used} · Total attempts: {lastResult.attempts_used}</p>
              {lastResult.exhausted && <p className="text-court-red">⚠ Allowance exhausted mid-wallet</p>}
              {lastResult.case_slug && <Link to={`/case/${lastResult.case_slug}`} className="text-court-chart hover:underline">View case →</Link>}
            </div>
          </div>
        )}
      </div>

      {/* Wallet queue */}
      <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5">
        <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg mb-4">Wallet Queue ({wallets.length}/5)</h2>
        <form onSubmit={handleAddWallet} className="flex gap-2 mb-4">
          <input
            type="text"
            value={walletInput}
            onChange={(e) => setWalletInput(e.target.value)}
            placeholder="0x… Robinhood wallet address"
            spellCheck={false}
            className="court-input flex-1 px-3 py-2.5 font-mono text-sm"
          />
          <button type="submit" disabled={submitting || wallets.length >= 5}
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy disabled:opacity-60">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
          </button>
        </form>
        {wallets.length === 0 ? (
          <p className="font-mono text-base text-court-mute">No wallets in queue. Add up to 5 Robinhood wallet addresses above.</p>
        ) : (
          <div className="overflow-x-auto border-2 border-court-mute/40">
            <table className="w-full font-mono text-xs">
              <thead className="bg-court-uv text-court-ice uppercase tracking-[0.1em]">
                <tr>
                  <th className="p-2 text-left">#</th>
                  <th className="p-2 text-left">Address</th>
                  <th className="p-2 text-left">Status</th>
                  <th className="p-2 text-left">Verdict</th>
                  <th className="p-2 text-left">Calls</th>
                  <th className="p-2 text-left">Case</th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((w, i) => (
                  <tr key={w.wallet_id} className="border-t border-court-mute/40 text-court-ice">
                    <td className="p-2">{i + 1}</td>
                    <td className="p-2 whitespace-nowrap">{w.address_short}</td>
                    <td className={cn("p-2 uppercase", w.status === "completed" ? "text-court-chart" : w.status === "failed" || w.status === "stopped" ? "text-court-red" : w.status === "processing" ? "text-court-chart animate-blink" : "text-court-mute")}>{w.status}</td>
                    <td className="p-2">{w.verdict_name || (w.failure_category ? w.failure_category : "—")}</td>
                    <td className="p-2">{w.calls_used ?? "—"}</td>
                    <td className="p-2">{w.case_slug ? <Link to={`/case/${w.case_slug}`} className="text-court-chart hover:underline">View</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Coverage notice */}
      <div className="border-2 border-court-mute/40 bg-court-navy/60 p-4 font-mono text-sm text-court-mute leading-relaxed">
        <p className="text-court-ice mb-1">⚠ Nansen Coverage Notice</p>
        Robinhood Chain data coverage starts 2026-04-30. Analysis windows are automatically clamped — requests for earlier data will show a "limited history" disclosure on the case page.
      </div>
    </div>
  );
}

function Stat({ label, value, sub, highlight }) {
  return (
    <div className={cn("border-2 p-3", highlight ? "border-court-red bg-court-red/10" : "border-court-mute/40")}>
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute">{label}</p>
      <p className={cn("font-display text-xl mt-1", highlight ? "text-court-red" : "text-court-ice")}>{value}</p>
      {sub && <p className="font-mono text-xs text-court-mute mt-0.5">{sub}</p>}
    </div>
  );
}