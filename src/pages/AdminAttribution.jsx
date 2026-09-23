import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2, Send, RotateCw, Check, X, Activity, Clock } from "lucide-react";

export default function AdminAttribution() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testRef, setTestRef] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [retrying, setRetrying] = useState(null);

  useEffect(() => {
    (async () => {
      try { setUser(await base44.auth.me()); } catch { setUser(null); } finally { setAuthChecked(true); }
    })();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("getAttributionOutbox", {});
      if (res?.data?.error) setError(res.data.error);
      else { setData(res.data); setError(""); }
    } catch (e) {
      setError(e?.message || "Failed to load attribution outbox.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authChecked && user?.role === "admin") loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user]);

  async function runTest() {
    if (!testRef.trim()) { setError("Enter a ref code to test."); return; }
    setTesting(true); setTestResult(null); setError("");
    try {
      const res = await base44.functions.invoke("sendWalletCourtAttributionTest", { ref_code: testRef.trim() });
      if (res?.data?.error) setError(res.data.error);
      else setTestResult(res.data);
    } catch (e) {
      setError(e?.message || "Test failed.");
    } finally {
      setTesting(false);
    }
  }

  async function manualRetry(eventId) {
    setRetrying(eventId); setError("");
    try {
      const res = await base44.functions.invoke("retryWalletCourtAttribution", { event_id: eventId });
      if (res?.data?.error) setError(res.data.error);
      else await loadData();
    } catch (e) {
      setError(e?.message || "Retry failed.");
    } finally {
      setRetrying(null);
    }
  }

  if (!authChecked) return <div className="mx-auto max-w-md px-4 pt-24 text-center font-mono text-base text-court-ice animate-blink">Checking credentials…</div>;
  if (!user) return <AccessDenied message="Sign in to access the attribution dashboard." />;
  if (user.role !== "admin") return <AccessDenied message="Admin access required." />;

  const stats = data?.stats || { pending: 0, delivered: 0, retry_scheduled: 0, permanently_failed: 0, total: 0 };
  const recent = data?.recent || [];

  return (
    <section className="mx-auto max-w-4xl px-4 pt-8 sm:pt-12 pb-20">
      <header className="mb-6">
        <h1 className="font-display uppercase leading-[0.86] text-court-ice" style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)" }}>
          Attribution Delivery
        </h1>
        <p className="mt-2 font-mono text-base text-court-ice leading-relaxed">
          Wallet Court → ShoutIt creator-attribution outbox. Events are signed server-side and delivered with bounded retry.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-4 py-3 text-sm text-court-red mb-4">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="font-mono leading-relaxed">{error}</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Stat label="Pending" value={stats.pending} />
        <Stat label="Delivered" value={stats.delivered} accent />
        <Stat label="Retry Scheduled" value={stats.retry_scheduled} />
        <Stat label="Permanently Failed" value={stats.permanently_failed} danger />
      </div>

      {/* Last delivery + last error */}
      <div className="grid sm:grid-cols-2 gap-3 mb-6">
        <div className="border-2 border-court-chart bg-court-navy p-4">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-1">Last Successful Delivery</p>
          {data?.last_delivered ? (
            <>
              <p className="font-display text-court-chart text-lg">{data.last_delivered.event_type}</p>
              <p className="font-mono text-xs text-court-ice mt-1">ref: {data.last_delivered.ref_code}</p>
              <p className="font-mono text-xs text-court-mute">{data.last_delivered.receiver_result}</p>
              <p className="font-mono text-xs text-court-mute">{data.last_delivered.delivered_at ? new Date(data.last_delivered.delivered_at).toLocaleString() : "—"}</p>
            </>
          ) : (
            <p className="font-mono text-sm text-court-mute">No deliveries yet.</p>
          )}
        </div>
        <div className="border-2 border-court-red bg-court-navy p-4">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-1">Last Receiver Error</p>
          {data?.last_error ? (
            <>
              <p className="font-display text-court-red text-lg">{data.last_error.event_type}</p>
              <p className="font-mono text-xs text-court-ice mt-1">{data.last_error.last_error_code}</p>
              <p className="font-mono text-xs text-court-mute">{data.last_error.last_error_summary}</p>
              <p className="font-mono text-xs text-court-mute">{data.last_error.last_attempt_at ? new Date(data.last_error.last_attempt_at).toLocaleString() : "—"}</p>
            </>
          ) : (
            <p className="font-mono text-sm text-court-mute">No errors.</p>
          )}
        </div>
      </div>

      {/* Signed test */}
      <div className="border-2 border-court-uv bg-court-navy p-4 sm:p-5 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Send className="h-5 w-5 text-court-chart" />
          <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg">Run Signed Test</h2>
        </div>
        <p className="font-mono text-sm text-court-ice leading-relaxed mb-3">
          Enqueues one signed test event with a caller-provided ref code and delivers it immediately via the real production signing path. Marked with test_event=true. Never requires a real wallet or Nansen call.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={testRef}
            onChange={(e) => setTestRef(e.target.value)}
            placeholder="creatorname"
            className="court-input flex-1 px-3 py-2 font-mono text-sm"
          />
          <button
            type="button"
            onClick={runTest}
            disabled={testing}
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-60"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send Test
          </button>
        </div>
        {testResult && (
          <div className="mt-3 border-2 border-court-ice p-3 font-mono text-xs text-court-ice">
            <p className="uppercase tracking-[0.1em] text-court-mute mb-1">Receiver Response</p>
            <p>Status: <span className={cn(testResult.delivery?.delivered ? "text-court-chart" : "text-court-red")}>{testResult.delivery?.status_code} — {testResult.delivery?.receiver_result || testResult.delivery?.error_summary}</span></p>
            <p>Event ID: <span className="text-court-mute">{testResult.event_id}</span></p>
            {testResult.delivery?.error_code && <p>Error: <span className="text-court-red">{testResult.delivery.error_code}</span></p>}
          </div>
        )}
      </div>

      {/* Recent events */}
      <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">Recent Events</h2>
      {loading ? (
        <p className="font-mono text-base text-court-ice animate-blink">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="font-mono text-base text-court-mute">No attribution events yet.</p>
      ) : (
        <div className="overflow-x-auto border-2 border-court-ice">
          <table className="w-full font-mono text-xs">
            <thead className="bg-court-uv text-court-ice uppercase tracking-[0.1em]">
              <tr>
                <th className="text-left p-2">Event Type</th>
                <th className="text-left p-2">Ref</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Attempts</th>
                <th className="text-left p-2">Receiver</th>
                <th className="text-left p-2">Created</th>
                <th className="text-left p-2">Retry</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.event_id} className="border-t border-court-mute/40 text-court-ice">
                  <td className="p-2">{e.event_type}</td>
                  <td className="p-2 text-court-mute">{e.ref_code}</td>
                  <td className={cn("p-2 uppercase", e.status === "delivered" ? "text-court-chart" : e.status === "permanently_failed" ? "text-court-red" : "text-court-ice")}>{e.status}</td>
                  <td className="p-2">{e.attempt_count}</td>
                  <td className="p-2 text-court-mute truncate max-w-[10rem]">{e.receiver_result || e.last_error_code || "—"}</td>
                  <td className="p-2 text-court-mute whitespace-nowrap">{e.created_date ? new Date(e.created_date).toLocaleString() : "—"}</td>
                  <td className="p-2">
                    {e.status !== "delivered" && (
                      <button
                        type="button"
                        onClick={() => manualRetry(e.event_id)}
                        disabled={retrying === e.event_id}
                        className="inline-flex items-center gap-1 text-court-chart hover:brightness-110 disabled:opacity-50"
                      >
                        {retrying === e.event_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />} Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 text-center">
        <Link to="/admin/nansen-usage" className="inline-flex items-center gap-2 text-court-chart font-display uppercase tracking-[0.08em] text-sm hover:brightness-110">
          ← Back to Nansen Usage
        </Link>
      </div>
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