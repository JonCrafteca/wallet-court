import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { AlertTriangle, Play, Pause, Square, Loader2, Check, X, KeyRound, Activity, Zap, Stethoscope } from "lucide-react";
import { NETWORKS, validateAddress, normalizeAddress } from "@/lib/wallet";
import AdminPilotPanel from "@/components/walletcourt/AdminPilotPanel";

const STOP_CATEGORIES = new Set(["missing_key", "auth", "plan_credit"]);
const ENDPOINT_LABELS = {
  pnl_summary: "PnL Summary",
  dex_trades: "DEX Trades",
  current_balance: "Current Balance",
  transactions: "Transactions",
  address_labels: "Address Labels"
};
const ENDPOINT_KEYS = Object.keys(ENDPOINT_LABELS);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export default function AdminNansenUsage() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [stats, setStats] = useState(null);
  const [circuit, setCircuit] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [error, setError] = useState("");
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthResult, setHealthResult] = useState(null);

  const [text, setText] = useState("");
  const [maxWallets, setMaxWallets] = useState(25);
  const [parsed, setParsed] = useState({ wallets: [], invalid: [] });
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, live: 0, partial: 0, demo: 0, failed: 0, current: null });
  const [runLog, setRunLog] = useState([]);
  const [stopReason, setStopReason] = useState("");

  const pauseRef = useRef(false);
  const stopRef = useRef(false);
  const runningRef = useRef(false);

  useEffect(() => {
    (async () => {
      try { setUser(await base44.auth.me()); } catch { setUser(null); } finally { setAuthChecked(true); }
    })();
  }, []);

  async function loadStats() {
    setLoadingStats(true);
    try {
      const res = await base44.functions.invoke("getNansenUsage", {});
      if (res?.data?.error) setError(res.data.error);
      else { setStats(res.data.stats); setCircuit(res.data.circuit || null); setRecent(res.data.recent || []); setError(""); }
    } catch (e) {
      setError(e?.message || "Failed to load usage.");
    } finally {
      setLoadingStats(false);
    }
  }

  useEffect(() => {
    if (authChecked && user?.role === "admin") loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user]);

  function parseInput() {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const seen = new Set();
    const wallets = [];
    const invalid = [];
    for (const line of lines) {
      let network = "ethereum";
      let addr = line;
      const i = line.indexOf(":");
      if (i > 0) {
        const n = line.slice(0, i).trim().toLowerCase();
        if (NETWORKS.includes(n)) { network = n; addr = line.slice(i + 1).trim(); }
      }
      if (!validateAddress(network, addr)) { invalid.push(line); continue; }
      const norm = normalizeAddress(network, addr);
      const key = `${network}|${norm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      wallets.push({ network, address: addr, normalized: norm });
    }
    setParsed({ wallets, invalid });
    return wallets;
  }

  useEffect(() => { parseInput(); }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  async function startRun() {
    if (runningRef.current) return;
    const wallets = parseInput();
    const cap = Math.max(1, Math.min(maxWallets || 1, wallets.length));
    const capped = wallets.slice(0, cap);
    if (capped.length === 0) { setError("No valid wallets to analyze."); return; }
    runningRef.current = true; setRunning(true);
    pauseRef.current = false; stopRef.current = false; setPaused(false); setStopReason("");
    setRunLog([]);
    setProgress({ done: 0, total: capped.length, live: 0, partial: 0, demo: 0, failed: 0, current: null });
    await loadStats();
    for (let i = 0; i < capped.length; i++) {
      if (stopRef.current) break;
      while (pauseRef.current && !stopRef.current) { await sleep(250); }
      if (stopRef.current) break;
      const w = capped[i];
      setProgress((p) => ({ ...p, current: w }));
      const entry = { wallet: w, outcome: null, error_category: null, error: null };
      try {
        const res = await base44.functions.invoke("analyzeWalletWithNansen", {
          wallet_address: w.address, network: w.network, window_days: 180
        });
        const a = res?.data?.analysis || {};
        entry.outcome = a.outcome; entry.error_category = a.error_category;
        setProgress((p) => ({
          ...p, done: p.done + 1,
          live: p.live + (a.outcome === "live" ? 1 : 0),
          partial: p.partial + (a.outcome === "partial" ? 1 : 0),
          demo: p.demo + (a.outcome === "demo" ? 1 : 0)
        }));
        if (res?.data?.error) { entry.error = res.data.error; setProgress((p) => ({ ...p, failed: p.failed + 1 })); }
        if (STOP_CATEGORIES.has(a.error_category)) { setStopReason(`Run stopped: ${a.error_category}`); stopRef.current = true; }
      } catch (e) {
        entry.error = e?.message || "Request failed";
        setProgress((p) => ({ ...p, done: p.done + 1, failed: p.failed + 1 }));
      }
      setRunLog((l) => [entry, ...l].slice(0, 60));
      await loadStats();
    }
    setProgress((p) => ({ ...p, current: null }));
    runningRef.current = false; setRunning(false); setPaused(false);
  }

  function pauseRun() { pauseRef.current = true; setPaused(true); }
  function resumeRun() { pauseRef.current = false; setPaused(false); }
  function stopRun() { stopRef.current = true; setPaused(false); }

  async function runHealthCheck() {
    setHealthChecking(true); setHealthResult(null); setError("");
    try {
      const res = await base44.functions.invoke("adminProviderHealthCheck", {});
      if (res?.data?.error) setError(res.data.error);
      else setHealthResult(res.data);
      await loadStats();
    } catch (e) {
      setError(e?.message || "Health check failed.");
    } finally {
      setHealthChecking(false);
    }
  }

  if (!authChecked) return <div className="mx-auto max-w-md px-4 pt-24 text-center font-mono text-base text-court-ice animate-blink">Checking credentials…</div>;
  if (!user) return <AccessDenied message="Sign in to access the Nansen usage dashboard." />;
  if (user.role !== "admin") return <AccessDenied message="Admin access required." />;

  const goal = stats?.goal || 1000;
  const successful = stats?.successful_calls || 0;
  const pct = Math.min(100, (successful / goal) * 100);
  const expectedCalls = Math.min(parsed.wallets.length, Math.max(1, maxWallets || 1)) * 4;
  const expectedCredits = expectedCalls; // 4 core calls × 1 credit each
  const byEp = stats?.by_endpoint || {};
  const coreCalls = (byEp.pnl_summary || 0) + (byEp.dex_trades || 0) + (byEp.current_balance || 0) + (byEp.transactions || 0);
  const labelCalls = byEp.address_labels || 0;
  const estimatedTotalCredits = coreCalls * 1 + labelCalls * 100;
  const actualCredits = stats?.credits_used ?? null;

  return (
    <section className="mx-auto max-w-5xl px-4 pt-8 sm:pt-12 pb-20">
      <header className="mb-6">
        <h1 className="font-display uppercase leading-[0.86] text-court-ice" style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)" }}>
          Nansen API Usage
        </h1>
        <p className="mt-2 font-mono text-base text-court-ice leading-relaxed">
          Audit of real Nansen profiler calls. Actual credits come from Nansen response headers; documented estimated credits (from official pricing) are shown separately and never presented as actual usage.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-4 py-3 text-sm text-court-red mb-4">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="font-mono leading-relaxed">{error}</span>
        </div>
      )}

      {/* Key health + goal */}
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <KeyHealth health={stats?.key_health} />
        <div className="border-2 border-court-ice bg-court-navy p-4">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-1">Successful Nansen API Calls</p>
          <p className="font-display text-court-ice text-3xl">{successful} <span className="text-court-mute text-xl">/ {goal}</span></p>
          <div className="mt-2 h-3 border-2 border-court-ice bg-court-navy">
            <div className="h-full bg-court-chart" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 font-mono text-xs text-court-mute">{pct.toFixed(1)}% of buildathon goal</p>
        </div>
      </div>

      {/* Provider circuit breaker (Phase N2.4) */}
      <CircuitPanel circuit={circuit} healthChecking={healthChecking} healthResult={healthResult} onHealthCheck={runHealthCheck} />

      {/* Stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Stat label="Live Cases" value={stats?.live_cases ?? 0} accent />
        <Stat label="Credits Used" value={stats?.credits_used ?? 0} />
        <Stat label="Credits Remaining" value={stats?.credits_remaining_latest == null ? "—" : stats.credits_remaining_latest} />
        <Stat label="Total Calls" value={stats?.total_calls ?? 0} />
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <Breakdown title="Calls by Endpoint" data={stats?.by_endpoint} labels={ENDPOINT_LABELS} order={ENDPOINT_KEYS} />
        <Breakdown title="Calls by Network" data={stats?.by_network} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-8">
        <Stat label="Successes" value={stats?.success_total ?? 0} accent />
        <Stat label="Failures" value={stats?.failure_total ?? 0} danger />
      </div>

      {/* Credit cost — actual vs documented estimated (item N2.1) */}
      <div className="border-2 border-court-chart bg-court-navy p-4 sm:p-5 mb-6">
        <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg mb-3">Credit Cost</h2>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div className="border-2 border-court-ice p-3">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-1">Inexpensive core calls (1 credit each)</p>
            <p className="font-display text-2xl text-court-ice">{coreCalls}</p>
          </div>
          <div className="border-2 border-court-red p-3">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-1">Expensive label calls (100 credits each)</p>
            <p className="font-display text-2xl text-court-red">{labelCalls}</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mb-3">
          <div className="border-2 border-court-mute/40 p-3">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-1">Documented estimated credits (pricing)</p>
            <p className="font-display text-2xl text-court-ice">{estimatedTotalCredits}</p>
          </div>
          <div className="border-2 border-court-mute/40 p-3">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-1">Actual credits reported by Nansen</p>
            <p className="font-display text-2xl text-court-chart">{actualCredits == null ? "—" : actualCredits}</p>
          </div>
        </div>
        <p className="font-mono text-xs text-court-mute leading-relaxed">Estimates use official Nansen pricing and are never presented as actual usage. Actual credits are read from Nansen response headers when available.</p>
      </div>

      {/* Corpus runner */}
      <div className="border-2 border-court-chart bg-court-navy p-4 sm:p-5 mb-8">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-5 w-5 text-court-chart" />
          <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg">Build Evidence Corpus</h2>
        </div>
        <p className="font-mono text-sm text-court-ice leading-relaxed mb-4">
          Paste public wallet addresses, one per line. Optionally prefix a network: <code className="text-court-chart">ethereum:0x…</code>, <code className="text-court-chart">base:0x…</code>, <code className="text-court-chart">solana:…</code>. Default is Ethereum. Addresses are validated and deduplicated. Each wallet is analyzed one at a time using the real four-endpoint pipeline (4 performance calls). Address Labels is never called automatically — it costs 100 credits per wallet and is admin-triggered only.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder={"ethereum:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045\nbase:0x…\nsolana:…"}
          className="w-full court-input px-3 py-2 font-mono text-sm leading-relaxed resize-y"
        />

        <div className="mt-3 flex flex-wrap items-end gap-4">
          <div>
            <label className="block font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-1">Max wallets per run</label>
            <input
              type="number" min={1} max={500} value={maxWallets}
              onChange={(e) => setMaxWallets(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))}
              className="court-input w-28 px-3 py-2 font-mono text-sm"
              disabled={running}
            />
          </div>
          <div className="font-mono text-sm text-court-ice leading-relaxed">
            <p>Wallets: <span className="text-court-chart">{parsed.wallets.length}</span>{parsed.invalid.length > 0 && <span className="text-court-red"> · {parsed.invalid.length} invalid</span>}</p>
            <p>Expected Nansen calls: <span className="text-court-chart">{expectedCalls}</span> (4 per wallet)</p>
            <p>Documented estimated credits: <span className="text-court-chart">{expectedCredits}</span> (1 per core call; labels not included)</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {!running ? (
            <button type="button" onClick={startRun} disabled={parsed.wallets.length === 0}
              className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-60">
              <Play className="h-4 w-4" /> Start Run
            </button>
          ) : (
            <>
              {paused ? (
                <button type="button" onClick={resumeRun} className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy">
                  <Play className="h-4 w-4" /> Resume
                </button>
              ) : (
                <button type="button" onClick={pauseRun} className="inline-flex items-center gap-2 bg-court-uv text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-ice">
                  <Pause className="h-4 w-4" /> Pause
                </button>
              )}
              <button type="button" onClick={stopRun} className="inline-flex items-center gap-2 bg-court-red text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-ice">
                <Square className="h-4 w-4" /> Stop
              </button>
            </>
          )}
        </div>

        {(running || progress.done > 0) && (
          <div className="mt-4 border-2 border-court-ice bg-court-navy p-3">
            <div className="flex items-center justify-between font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-2">
              <span>{running ? (paused ? "Paused" : "Running") : "Completed"}</span>
              <span>{progress.done} / {progress.total}</span>
            </div>
            <div className="h-3 border-2 border-court-ice bg-court-navy mb-3">
              <div className="h-full bg-court-chart" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
            <div className="grid grid-cols-4 gap-2 font-mono text-xs text-center">
              <Count label="Live" value={progress.live} cls="text-court-chart" />
              <Count label="Partial" value={progress.partial} cls="text-court-chart" />
              <Count label="Demo" value={progress.demo} cls="text-court-red" />
              <Count label="Failed" value={progress.failed} cls="text-court-red" />
            </div>
            {progress.current && running && (
              <p className="mt-2 font-mono text-xs text-court-mute truncate">Analyzing: {progress.current.network}:{progress.current.address}</p>
            )}
            {stopReason && <p className="mt-2 font-mono text-xs text-court-red">{stopReason}</p>}
          </div>
        )}

        {runLog.length > 0 && (
          <div className="mt-4">
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-2">Run Log</p>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {runLog.map((e, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-xs text-court-ice border-l-2 border-court-mute pl-2">
                  {e.error ? <X className="h-3.5 w-3.5 text-court-red shrink-0" /> : <Check className="h-3.5 w-3.5 text-court-chart shrink-0" />}
                  <span className="text-court-mute shrink-0">{e.wallet.network}</span>
                  <span className="truncate">{e.wallet.address}</span>
                  <span className={cn("ml-auto uppercase tracking-[0.1em] shrink-0", e.outcome === "live" ? "text-court-chart" : e.outcome === "partial" ? "text-court-chart" : "text-court-red")}>
                    {e.error ? "error" : e.outcome || "—"}{e.error_category ? ` · ${e.error_category}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Pilot review + label-only backfill (items N2.6 + N2.7) */}
      <AdminPilotPanel />

      {/* Recent log */}
      <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">Recent Request Log</h2>
      {loadingStats && !stats ? (
        <p className="font-mono text-base text-court-ice animate-blink">Loading usage…</p>
      ) : recent.length === 0 ? (
        <p className="font-mono text-base text-court-mute">No Nansen calls recorded yet.</p>
      ) : (
        <div className="overflow-x-auto border-2 border-court-ice">
          <table className="w-full font-mono text-xs">
            <thead className="bg-court-uv text-court-ice uppercase tracking-[0.1em]">
              <tr>
                <th className="text-left p-2">Endpoint</th>
                <th className="text-left p-2">Chain</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">HTTP</th>
                <th className="text-left p-2">Req ID</th>
                <th className="text-left p-2">Credits</th>
                <th className="text-left p-2">Outcome</th>
                <th className="text-left p-2">Case</th>
                <th className="text-left p-2">When</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i} className="border-t border-court-mute/40 text-court-ice">
                  <td className="p-2">{ENDPOINT_LABELS[r.endpoint] || r.endpoint}</td>
                  <td className="p-2">{r.chain}</td>
                  <td className={cn("p-2 uppercase", r.request_status === "success" ? "text-court-chart" : "text-court-red")}>{r.request_status}</td>
                  <td className="p-2">{r.http_status}</td>
                  <td className="p-2 truncate max-w-[8rem] text-court-mute">{r.nansen_request_id || "—"}</td>
                  <td className="p-2 text-court-mute">{r.credits_used != null ? r.credits_used : (r.credits_cost != null ? r.credits_cost : "—")}{r.credits_remaining != null ? ` (rem ${r.credits_remaining})` : ""}</td>
                  <td className="p-2 uppercase">{r.outcome}{r.error_category ? ` · ${r.error_category}` : ""}</td>
                  <td className="p-2 truncate max-w-[8rem]">{r.case_slug || "—"}</td>
                  <td className="p-2 text-court-mute whitespace-nowrap">{r.called_at ? new Date(r.called_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, accent, danger }) {
  return (
    <div className="border-2 border-court-ice bg-court-navy p-3">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-1">{label}</p>
      <p className={cn("font-display text-2xl", accent ? "text-court-chart" : danger ? "text-court-red" : "text-court-ice")}>{value}</p>
    </div>
  );
}

function Count({ label, value, cls }) {
  return (
    <div className="border-2 border-court-mute/40 p-2">
      <p className={cn("font-display text-lg", cls)}>{value}</p>
      <p className="text-court-mute uppercase tracking-[0.1em]">{label}</p>
    </div>
  );
}

function Breakdown({ title, data, labels, order }) {
  const entries = (order || Object.keys(data || {})).map((k) => [labels?.[k] || k, (data || {})[k] || 0]).filter(([, v]) => v);
  return (
    <div className="border-2 border-court-ice bg-court-navy p-4">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">{title}</p>
      {entries.length === 0 ? (
        <p className="font-mono text-sm text-court-mute">No calls yet.</p>
      ) : (
        <ul className="space-y-1 font-mono text-sm">
          {entries.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between">
              <span className="text-court-ice">{k}</span>
              <span className="text-court-chart">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KeyHealth({ health }) {
  const map = {
    healthy: { label: "Healthy", cls: "text-court-chart", note: "Recent successful Nansen responses recorded." },
    degraded: { label: "Degraded", cls: "text-court-red", note: "Recent calls failed without a clear auth/plan error." },
    invalid: { label: "Invalid Key", cls: "text-court-red", note: "Recent responses returned 401. Check NANSEN_API_KEY." },
    missing: { label: "No Key", cls: "text-court-red", note: "No API key configured. Live mode is unavailable." },
    unknown: { label: "Unknown", cls: "text-court-mute", note: "No Nansen calls recorded yet." }
  };
  const m = map[health] || map.unknown;
  return (
    <div className="border-2 border-court-ice bg-court-navy p-4 flex items-start gap-3">
      <KeyRound className={cn("h-5 w-5 shrink-0 mt-0.5", m.cls)} />
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-1">API-Key Health</p>
        <p className={cn("font-display text-2xl", m.cls)}>{m.label}</p>
        <p className="font-mono text-xs text-court-mute leading-relaxed mt-1">{m.note}</p>
      </div>
    </div>
  );
}

const RECESS_LABELS = {
  court_recess_credits: "Recess — Credits",
  court_recess_auth: "Recess — Auth",
  court_recess_rate_limit: "Recess — Rate Limit",
  court_recess_provider: "Recess — Provider",
  court_recess_unknown: "Recess — Unknown"
};

function CircuitPanel({ circuit, healthChecking, healthResult, onHealthCheck }) {
  if (!circuit) return null;
  const open = circuit.circuit_status === "open";
  const halfOpen = circuit.circuit_status === "half_open";
  const closed = circuit.circuit_status === "closed";
  const statusLabel = closed ? "Court Open" : halfOpen ? "Half-Open / Recovery Check" : (RECESS_LABELS[circuit.recess_type] || "Recess — Unknown");
  const tone = closed ? "text-court-chart" : halfOpen ? "text-court-chart" : "text-court-red";
  const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

  return (
    <div className={cn("border-2 bg-court-navy p-4 sm:p-5 mb-6", closed ? "border-court-chart" : "border-court-red")}>
      <div className="flex items-center gap-2 mb-3">
        <Zap className={cn("h-5 w-5 shrink-0", tone)} />
        <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-lg">Provider Circuit Breaker</h2>
        <span className={cn("ml-auto font-display uppercase tracking-[0.08em] text-sm", tone)}>{statusLabel}</span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        <CircuitStat label="Visitor Requests Blocked" value={circuit.visitor_requests_blocked ? "Yes" : "No"} danger={circuit.visitor_requests_blocked} />
        <CircuitStat label="Consecutive Failures" value={circuit.consecutive_failures ?? 0} danger={!!(circuit.consecutive_failures)} />
        <CircuitStat label="Retry In (s)" value={circuit.retry_in_seconds ?? 0} />
        <CircuitStat label="Opened At" value={fmt(circuit.opened_at)} />
        <CircuitStat label="Retry After" value={fmt(circuit.retry_after)} />
        <CircuitStat label="Recovered At" value={fmt(circuit.recovered_at)} />
        <CircuitStat label="Last Safe Request ID" value={circuit.last_request_id || "—"} mono />
        <CircuitStat label="Sanitized Reason" value={circuit.sanitized_reason || "—"} />
        <CircuitStat label="Half-Open Eligible" value={circuit.half_open_eligible ? "Yes" : "No"} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onHealthCheck}
          disabled={healthChecking || closed}
          className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-50 disabled:shadow-none"
        >
          {healthChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Stethoscope className="h-4 w-4" />} Run Health Check
        </button>
        <span className="font-mono text-xs text-court-mute leading-relaxed">
          Performs one controlled Nansen probe when the cooldown has elapsed. Visitors are never used as probes. No real probe is initiated during the implementation phase.
        </span>
      </div>
      {healthResult && (
        <div className="mt-3 border-2 border-court-mute/40 p-3 font-mono text-xs text-court-ice">
          <span className="uppercase tracking-[0.1em] text-court-mute">Probe result: </span>
          <span className={cn("uppercase", healthResult.status === "recovered" ? "text-court-chart" : healthResult.status === "closed" ? "text-court-mute" : "text-court-red")}>
            {healthResult.status}{healthResult.recess_type ? ` · ${healthResult.recess_type}` : ""}
          </span>
          {healthResult.message && <span className="text-court-mute"> — {healthResult.message}</span>}
        </div>
      )}
    </div>
  );
}

function CircuitStat({ label, value, danger, mono }) {
  return (
    <div className="border-2 border-court-mute/40 p-3">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-1">{label}</p>
      <p className={cn("font-mono text-sm leading-relaxed break-words", danger ? "text-court-red" : "text-court-ice", mono && "truncate")}>{value}</p>
    </div>
  );
}

function AccessDenied({ message }) {
  return (
    <div className="mx-auto max-w-xl px-4 pt-20 pb-24">
      <div className="border-2 border-court-red bg-court-navy p-6 sm:p-8 text-center">
        <p className="font-display uppercase text-court-red text-3xl mb-3 tracking-[0.04em]">Restricted</p>
        <p className="font-mono text-base text-court-ice mb-6 leading-relaxed">{message}</p>
        <Link to="/" className="inline-flex items-center justify-center bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all">
          Back to Court
        </Link>
      </div>
    </div>
  );
}