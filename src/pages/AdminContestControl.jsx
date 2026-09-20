import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, Loader2, Download, FileJson, FileSpreadsheet, RefreshCw,
  CheckCircle2, Circle, Activity, Target, Gauge, Clock, TrendingUp
} from "lucide-react";

const TARGET = 1000;

const READINESS_ITEMS = [
  { key: "live_url", label: "Live application URL ready" },
  { key: "github_repo", label: "Public GitHub repository ready" },
  { key: "docs", label: "README and architecture documentation ready" },
  { key: "demo_video", label: "Demo video recorded" },
  { key: "x_post", label: "X demo post published" },
  { key: "nansen_attribution", label: "Nansen attribution visible" },
  { key: "call_target", label: "Verified call target reached" },
  { key: "proof_export", label: "Proof export downloaded" },
  { key: "final_submission", label: "Final submission completed" }
];

export default function AdminContestControl() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(25);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(null);

  useEffect(() => {
    (async () => {
      try { setUser(await base44.auth.me()); } catch { setUser(null); } finally { setAuthChecked(true); }
    })();
  }, []);

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    setError("");
    try {
      const res = await base44.functions.invoke("getContestControl", { offset: off, limit });
      const d = res?.data;
      if (d?.error) { setError(d.error); return; }
      setStats(d.stats);
      setRecent(d.recent || []);
      setTotal(d.total || 0);
      setOffset(d.offset || 0);
      setHasMore(!!d.has_more);
    } catch (e) {
      setError(e?.message || "Failed to load contest control data.");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    if (authChecked && user?.role === "admin") load(0);
  }, [authChecked, user, load]);

  async function handleExport(format) {
    setExporting(format);
    try {
      const res = await base44.functions.invoke("exportContestProof", { format });
      const d = res?.data;
      if (d?.error) { setError(d.error); return; }
      const content = d.content;
      const blob = format === "csv"
        ? new Blob([content], { type: "text/csv;charset=utf-8" })
        : new Blob([JSON.stringify(content, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = d.filename || `wallet-court-nansen-call-proof.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e?.message || "Export failed.");
    } finally {
      setExporting(null);
    }
  }

  if (!authChecked) return <div className="mx-auto max-w-md px-4 pt-24 text-center font-mono text-base text-court-ice animate-blink">Checking credentials…</div>;
  if (!user) return <AccessDenied message="Sign in to access Contest Control." />;
  if (user.role !== "admin") return <AccessDenied message="Admin access required." />;

  const verified = stats?.verified_total ?? 0;
  const remaining = stats?.remaining ?? TARGET;
  const pct = stats?.percent_complete ?? 0;
  const callTargetReached = verified >= TARGET;

  return (
    <section className="mx-auto max-w-5xl px-4 pt-8 sm:pt-12 pb-20">
      <header className="mb-6">
        <h1 className="font-display uppercase leading-[0.86] text-court-ice" style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)" }}>
          Contest Control
        </h1>
        <p className="mt-2 font-mono text-base text-court-ice leading-relaxed">
          Verified outbound Nansen request ledger. Every record is one physical provider request — no backfill, no estimates, no demo counts.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-4 py-3 text-sm text-court-red mb-4">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="font-mono leading-relaxed">{error}</span>
        </div>
      )}

      {/* Primary progress */}
      <div className="border-2 border-court-chart bg-court-navy p-4 sm:p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Target className="h-5 w-5 text-court-chart" />
          <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg">Verified Outbound Requests</h2>
        </div>
        <div className="grid sm:grid-cols-3 gap-3 mb-4">
          <BigStat label="Tracked Requests" value={`${verified} / ${TARGET}`} accent />
          <BigStat label="Remaining" value={remaining} />
          <BigStat label="Percent Complete" value={`${pct.toFixed(1)}%`} />
        </div>
        <div className="h-4 border-2 border-court-ice bg-court-navy mb-4">
          <div className="h-full bg-court-chart transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          <SmallStat icon={<Clock className="h-3.5 w-3.5" />} label="Tracking Began" value={stats?.tracking_start ? new Date(stats.tracking_start).toLocaleString() : "No records yet"} />
          <SmallStat icon={<Activity className="h-3.5 w-3.5" />} label="Most Recent Request" value={stats?.most_recent ? new Date(stats.most_recent).toLocaleString() : "—"} />
          <SmallStat icon={<TrendingUp className="h-3.5 w-3.5" />} label="Calls Today (UTC)" value={stats?.calls_today_utc ?? 0} />
        </div>
        <p className="mt-3 font-mono text-xs text-court-mute leading-relaxed">
          Labeled as tracked outbound requests — not automatically Nansen-confirmed contest eligibility. Verified tracking began only after instrumentation; existing cases were not backfilled.
        </p>
      </div>

      {/* Quality breakdown */}
      <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Gauge className="h-5 w-5 text-court-ice" />
          <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-lg">Quality Breakdown</h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <BigStat label="Successful" value={stats?.successful ?? 0} accent />
          <BigStat label="Failed" value={stats?.failed ?? 0} danger />
          <BigStat label="Rate-Limited" value={stats?.rate_limited ?? 0} />
          <BigStat label="Timeout / Network" value={stats?.timeouts_or_network ?? 0} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <SmallStat label="Success Rate" value={`${((stats?.success_rate ?? 0) * 100).toFixed(1)}%`} />
          <SmallStat label="Average Latency" value={stats?.average_latency_ms != null ? `${Math.round(stats.average_latency_ms)} ms` : "—"} />
          <SmallStat label="Total Records" value={total} />
        </div>
        <div className="mt-4">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-2">Status-Code Breakdown</p>
          <Breakdown data={stats?.by_status} />
        </div>
      </div>

      {/* Product breakdown */}
      <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5 mb-6">
        <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-lg mb-4">Product Breakdown</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-4">
          <BreakdownPanel title="By Endpoint" data={stats?.by_endpoint} />
          <BreakdownPanel title="By Workflow" data={stats?.by_workflow} />
          <BreakdownPanel title="By Network" data={stats?.by_network} />
          <BreakdownPanel title="By UTC Day" data={stats?.by_utc_day} />
        </div>
        <div className="grid sm:grid-cols-2 gap-3 border-t-2 border-court-mute/40 pt-4">
          <SmallStat label="Avg Calls per Completed Live Case" value={stats?.average_calls_per_case ? stats.average_calls_per_case.toFixed(2) : "—"} />
          <SmallStat label="Est. Additional Cases to Target" value={stats?.estimated_cases_to_target ?? TARGET} />
        </div>
        <p className="mt-2 font-mono text-xs text-court-mute leading-relaxed">
          Estimate only. Cases-to-target divides remaining requests by the observed average calls per case; with zero data the full target is shown.
        </p>
      </div>

      {/* Exports */}
      <div className="border-2 border-court-chart bg-court-navy p-4 sm:p-5 mb-6">
        <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg mb-3">Judge-Ready Proof Export</h2>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => handleExport("json")}
            disabled={exporting !== null}
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-60"
          >
            {exporting === "json" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />} Export JSON
          </button>
          <button
            type="button"
            onClick={() => handleExport("csv")}
            disabled={exporting !== null}
            className="inline-flex items-center gap-2 bg-court-uv text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-ice hover:brightness-110 transition-all disabled:opacity-60"
          >
            {exporting === "csv" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Export CSV
          </button>
          <button
            type="button"
            onClick={() => load(0)}
            disabled={loading}
            className="inline-flex items-center gap-2 border-2 border-court-ice text-court-ice font-mono text-xs uppercase tracking-[0.1em] px-3 py-2.5 hover:bg-court-uv transition-colors disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </button>
        </div>
        <p className="mt-3 font-mono text-xs text-court-mute leading-relaxed">
          Exports contain sanitized audit rows, aggregate totals, methodology, and a deterministic SHA-256 integrity digest. Never includes wallet addresses, secrets, user IDs, or raw evidence.
        </p>
      </div>

      {/* Recent activity */}
      <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">Recent Activity</h2>
      {loading && recent.length === 0 ? (
        <p className="font-mono text-base text-court-ice animate-blink">Loading ledger…</p>
      ) : recent.length === 0 ? (
        <div className="border-2 border-dashed border-court-mute bg-court-navy p-8 text-center">
          <p className="font-display uppercase tracking-[0.06em] text-court-mute text-xl mb-2">No tracked requests yet</p>
          <p className="font-mono text-base text-court-mute leading-relaxed max-w-xl mx-auto">
            Verified tracking begins with the first real outbound Nansen request after instrumentation. No historical records were backfilled.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto border-2 border-court-ice">
            <table className="w-full font-mono text-xs">
              <thead className="bg-court-uv text-court-ice uppercase tracking-[0.1em]">
                <tr>
                  <th className="text-left p-2">Timestamp</th>
                  <th className="text-left p-2">Endpoint</th>
                  <th className="text-left p-2">Workflow</th>
                  <th className="text-left p-2">Network</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Latency</th>
                  <th className="text-left p-2">Corr ID</th>
                  <th className="text-left p-2">Case</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={r.call_id} className="border-t border-court-mute/40 text-court-ice">
                    <td className="p-2 whitespace-nowrap text-court-mute">{r.occurred_at ? new Date(r.occurred_at).toLocaleString() : "—"}</td>
                    <td className="p-2">{r.endpoint_key}</td>
                    <td className="p-2">{r.workflow}</td>
                    <td className="p-2">{r.network}</td>
                    <td className={cn("p-2 uppercase", r.outcome === "success" ? "text-court-chart" : "text-court-red")}>
                      {r.outcome}{r.response_status != null ? ` · ${r.response_status}` : ""}
                    </td>
                    <td className="p-2 text-court-mute">{r.latency_ms != null ? `${r.latency_ms}ms` : "—"}</td>
                    <td className="p-2 text-court-mute truncate max-w-[7rem]">{r.correlation_id_short || "—"}</td>
                    <td className="p-2 truncate max-w-[8rem]">{r.case_slug ? <Link to={`/case/${r.case_slug}`} className="text-court-chart hover:underline">{r.case_slug}</Link> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <p className="font-mono text-xs text-court-mute">Showing {recent.length} of {total}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => load(Math.max(0, offset - limit))}
                disabled={offset === 0 || loading}
                className="border-2 border-court-ice px-3 py-1.5 font-mono text-xs uppercase tracking-[0.1em] text-court-ice hover:bg-court-uv transition-colors disabled:opacity-40"
              >
                Prev
              </button>
              <button
                type="button"
                onClick={() => load(offset + limit)}
                disabled={!hasMore || loading}
                className="border-2 border-court-ice px-3 py-1.5 font-mono text-xs uppercase tracking-[0.1em] text-court-ice hover:bg-court-uv transition-colors disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Submission readiness */}
      <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5 mt-8">
        <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-lg mb-1">Submission Readiness</h2>
        <p className="font-mono text-xs text-court-mute leading-relaxed mb-4">
          Read-only preparation checklist. Confirm each item manually; Wallet Court verifies only the call target. No checklist state is stored.
        </p>
        <ul className="grid sm:grid-cols-2 gap-2">
          {READINESS_ITEMS.map((item) => {
            const verified = item.key === "call_target" ? callTargetReached : false;
            return (
              <li key={item.key} className="flex items-start gap-2 border-2 border-court-mute/40 p-3">
                {verified
                  ? <CheckCircle2 className="h-4 w-4 text-court-chart shrink-0 mt-0.5" />
                  : <Circle className="h-4 w-4 text-court-mute shrink-0 mt-0.5" />}
                <span className={cn("font-mono text-sm leading-relaxed", verified ? "text-court-chart" : "text-court-ice")}>
                  {item.label}
                  {item.key === "call_target" && (
                    <span className="block text-xs text-court-mute mt-0.5">
                      {callTargetReached ? "Target reached." : `${remaining} calls remaining.`}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function BigStat({ label, value, accent, danger }) {
  return (
    <div className="border-2 border-court-ice p-3">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-1">{label}</p>
      <p className={cn("font-display text-2xl", accent ? "text-court-chart" : danger ? "text-court-red" : "text-court-ice")}>{value}</p>
    </div>
  );
}

function SmallStat({ icon, label, value }) {
  return (
    <div className="border-2 border-court-mute/40 p-3">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-1 flex items-center gap-1">{icon}{label}</p>
      <p className="font-mono text-sm text-court-ice leading-relaxed break-words">{value}</p>
    </div>
  );
}

function BreakdownPanel({ title, data }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="border-2 border-court-mute/40 p-3">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">{title}</p>
      {entries.length === 0 ? (
        <p className="font-mono text-sm text-court-mute">No data yet.</p>
      ) : (
        <ul className="space-y-1 font-mono text-sm">
          {entries.map(([k, v]) => (
            <li key={k} className="flex items-center justify-between">
              <span className="text-court-ice truncate">{k}</span>
              <span className="text-court-chart ml-2">{v}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Breakdown({ data }) {
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="font-mono text-sm text-court-mute">No data yet.</p>;
  return (
    <ul className="flex flex-wrap gap-2">
      {entries.map(([k, v]) => (
        <li key={k} className="border-2 border-court-mute/40 px-2 py-1 font-mono text-xs text-court-ice">
          {k}: <span className="text-court-chart">{v}</span>
        </li>
      ))}
    </ul>
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