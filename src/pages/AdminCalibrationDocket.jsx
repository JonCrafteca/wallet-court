import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Loader2, RefreshCw, AlertTriangle, Lock, Unlock, ArrowLeft, ExternalLink } from "lucide-react";
import CalibrationImportForm from "@/components/walletcourt/CalibrationImportForm";
import CalibrationBatchControls from "@/components/walletcourt/CalibrationBatchControls";

// Admin-only Calibration Docket dashboard.
export default function AdminCalibrationDocket() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authStatus, setAuthStatus] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await base44.functions.invoke("getCalibrationDocket", {});
      if (res?.status === 401) { setAuthStatus(401); return; }
      if (res?.status === 403) { setAuthStatus(403); return; }
      if (res?.data?.error) { setError(res.data.error); return; }
      setData(res?.data);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 401) setAuthStatus(401);
      else if (status === 403) setAuthStatus(403);
      else setError(e?.response?.data?.error || e?.message || "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleTogglePause() {
    try {
      await base44.functions.invoke("getCalibrationDocket", { action: "toggle_pause" });
      load();
    } catch (e) {
      setError(e?.message || "Toggle failed.");
    }
  }

  if (authStatus === 401) return <AccessDenied message="Unauthorized. Sign in to access the Calibration Docket." />;
  if (authStatus === 403) return <AccessDenied message="Admin access required." />;

  if (loading && !data) {
    return (
      <section className="mx-auto max-w-5xl px-4 pt-20 pb-24 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-court-chart mx-auto" />
        <p className="font-mono text-sm text-court-mute mt-3">Loading calibration docket…</p>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="mx-auto max-w-5xl px-4 pt-10 pb-24">
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-4 py-3 max-w-xl mx-auto">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-court-red" />
          <span className="font-mono text-sm text-court-red">{error}</span>
        </div>
        <button onClick={load} className="mt-4 font-mono text-sm text-court-chart hover:text-court-ice underline">Retry</button>
      </section>
    );
  }

  const control = data?.control;
  const coverage = data?.coverage;
  const items = data?.items || [];
  const pendingCount = coverage?.pending || 0;
  const completedItems = items.filter((i) => i.status === "completed");

  return (
    <section className="mx-auto max-w-5xl px-4 pt-10 sm:pt-14 pb-24">
      <Link to="/admin/contest-control" className="inline-flex items-center gap-1.5 font-mono text-sm uppercase tracking-[0.12em] text-court-chart hover:text-court-ice transition-colors mb-4">
        <ArrowLeft className="h-4 w-4" /> Contest Control
      </Link>

      <header className="mb-6">
        <h1 className="font-display uppercase leading-[0.86] text-court-ice" style={{ fontSize: "clamp(1.8rem, 5vw, 3rem)" }}>
          Calibration Docket
        </h1>
        <p className="mt-2 font-mono text-sm text-court-mute max-w-2xl">
          Process unique, manually approved wallets through the real Wallet Court pipeline for verdict calibration and contest-call completion. Every completed item is a genuine live analysis.
        </p>
      </header>

      {/* Budget + Control bar */}
      <div className="grid sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Verified Calls" value={`${data?.verified_total || 0} / ${data?.target || 1000}`} />
        <StatCard label="Remaining" value={Math.max(0, (data?.target || 1000) - (data?.verified_total || 0))} />
        <StatCard label="Pending Queue" value={pendingCount} />
        <StatCard label="Completed" value={coverage?.completed || 0} />
      </div>

      {/* Kill switch */}
      <div className="flex items-center gap-3 mb-6">
        <button
          type="button"
          onClick={handleTogglePause}
          className={control?.calibration_enabled
            ? "inline-flex items-center gap-2 border-2 border-court-red text-court-red font-mono text-sm uppercase px-3 py-1.5 hover:bg-court-red hover:text-court-ice transition-colors"
            : "inline-flex items-center gap-2 border-2 border-court-chart text-court-chart font-mono text-sm uppercase px-3 py-1.5 hover:bg-court-chart hover:text-court-navy transition-colors"
          }
        >
          {control?.calibration_enabled ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          {control?.calibration_enabled ? "Pause Calibration" : "Resume Calibration"}
        </button>
        {control && !control.calibration_enabled && (
          <span className="font-mono text-sm text-court-red">Paused: {control.paused_reason || "Manually paused"}</span>
        )}
        {control?.ceiling_reached && (
          <span className="font-mono text-sm text-court-red">⚠ Safety ceiling (1,020) reached — locked.</span>
        )}
        <button onClick={load} className="ml-auto inline-flex items-center gap-1 font-mono text-sm text-court-chart hover:text-court-ice">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Budget stop */}
      {data?.budget && !data.budget.allowed && (
        <div className="mb-6 border-2 border-court-red bg-court-navy px-4 py-3">
          <p className="font-mono text-sm text-court-red">{data.budget.reason}</p>
        </div>
      )}

      {/* Import + Batch side by side */}
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <CalibrationImportForm onImported={load} />
        <CalibrationBatchControls
          verifiedTotal={data?.verified_total || 0}
          target={data?.target || 1000}
          ceiling={data?.ceiling || 1020}
          pendingCount={pendingCount}
          onBatchComplete={load}
        />
      </div>

      {/* Coverage */}
      {coverage && (
        <div className="mb-6 border-2 border-court-ice/40 bg-court-navy p-5">
          <h3 className="font-display uppercase text-court-ice text-lg mb-3">Coverage</h3>
          <div className="grid sm:grid-cols-3 gap-4 font-mono text-sm">
            <CoverageBlock label="By Network" data={coverage.by_network} />
            <CoverageBlock label="By Status" data={coverage.by_status} />
            <CoverageBlock label="By Objective" data={coverage.by_objective} />
          </div>
          <div className="mt-3 grid sm:grid-cols-2 gap-4 font-mono text-sm">
            <div>
              <p className="text-court-mute text-xs uppercase mb-1">Live vs Dismissed</p>
              <p className="text-court-ice">Live: {coverage.live_vs_dismissed.live} · Dismissed: {coverage.live_vs_dismissed.dismissed} · Mistrial: {coverage.live_vs_dismissed.mistrial}</p>
            </div>
            <div>
              <p className="text-court-mute text-xs uppercase mb-1">Successful vs Failed</p>
              <p className="text-court-ice">Successful: {coverage.successful_vs_failed.successful} · Failed: {coverage.successful_vs_failed.failed}</p>
            </div>
          </div>
          {data?.coverage_recommendations?.length > 0 && (
            <div className="mt-3 border-t border-court-ice/20 pt-3">
              <p className="font-mono text-xs uppercase text-court-chart mb-1">Recommendations</p>
              {data.coverage_recommendations.map((r, i) => (
                <p key={i} className="font-mono text-xs text-court-mute">• {r}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent completed */}
      {completedItems.length > 0 && (
        <div className="border-2 border-court-ice/40 bg-court-navy p-5">
          <h3 className="font-display uppercase text-court-ice text-lg mb-3">Recent Completed Cases</h3>
          <div className="space-y-2">
            {completedItems.slice(0, 10).map((item) => (
              <div key={item.docket_item_id} className="flex items-center justify-between font-mono text-sm border-b border-court-ice/10 pb-2">
                <div>
                  <span className="text-court-ice">{item.address_short}</span>
                  <span className="text-court-mute ml-2">{item.network}</span>
                </div>
                <div className="flex items-center gap-3">
                  {item.verdict_name && <span className="text-court-chart">{item.verdict_name}</span>}
                  {item.case_outcome && !item.verdict_name && <span className="text-court-mute">{item.case_outcome}</span>}
                  {item.physical_calls_used != null && <span className="text-court-mute">{item.physical_calls_used} calls</span>}
                  {item.case_slug && (
                    <Link to={`/case/${item.case_slug}`} className="inline-flex items-center gap-1 text-court-chart hover:text-court-ice">
                      View <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length === 0 && !loading && (
        <div className="border-2 border-dashed border-court-mute bg-court-navy p-8 text-center">
          <p className="font-display uppercase text-court-mute text-xl mb-2">Queue is empty</p>
          <p className="font-mono text-sm text-court-mute">Import wallets above to begin calibration.</p>
        </div>
      )}
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="border-2 border-court-ice/40 bg-court-navy p-3">
      <p className="font-mono text-xs uppercase text-court-mute">{label}</p>
      <p className="font-display text-court-ice text-xl mt-1">{value}</p>
    </div>
  );
}

function CoverageBlock({ label, data }) {
  return (
    <div>
      <p className="text-court-mute text-xs uppercase mb-1">{label}</p>
      <div className="space-y-0.5">
        {Object.entries(data || {}).map(([k, v]) => (
          <p key={k} className="text-court-ice">{k}: <span className="text-court-chart">{v}</span></p>
        ))}
        {Object.keys(data || {}).length === 0 && <p className="text-court-mute">—</p>}
      </div>
    </div>
  );
}

function AccessDenied({ message }) {
  return (
    <section className="mx-auto max-w-xl px-4 pt-20 pb-24 text-center">
      <AlertTriangle className="h-8 w-8 text-court-red mx-auto mb-3" />
      <p className="font-display uppercase text-court-red text-2xl mb-2">Access Denied</p>
      <p className="font-mono text-sm text-court-mute">{message}</p>
    </section>
  );
}