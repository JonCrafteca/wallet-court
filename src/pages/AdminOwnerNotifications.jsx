import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2, Send, RotateCw, Mail, Settings, Activity } from "lucide-react";

export default function AdminOwnerNotifications() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [settings, setSettings] = useState(null);
  const [outbox, setOutbox] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [retrying, setRetrying] = useState(null);
  const [retryingAll, setRetryingAll] = useState(false);
  const [form, setForm] = useState({
    recipient_email: "",
    master_enabled: false,
    signup_enabled: true,
    claim_enabled: true,
    verdict_enabled: true
  });

  useEffect(() => {
    (async () => {
      try { setUser(await base44.auth.me()); } catch { setUser(null); } finally { setAuthChecked(true); }
    })();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [settingsRes, outboxRes] = await Promise.all([
        base44.functions.invoke("getOwnerNotificationSettings", {}),
        base44.functions.invoke("getOwnerNotificationOutbox", {})
      ]);
      const s = settingsRes?.data?.settings;
      if (s) {
        setSettings(s);
        setForm({
          recipient_email: s.recipient_email || "",
          master_enabled: s.master_enabled ?? false,
          signup_enabled: s.signup_enabled ?? true,
          claim_enabled: s.claim_enabled ?? true,
          verdict_enabled: s.verdict_enabled ?? true
        });
      }
      if (outboxRes?.data) setOutbox(outboxRes.data);
      if (settingsRes?.data?.error) setError(settingsRes.data.error);
      else if (outboxRes?.data?.error) setError(outboxRes.data.error);
      else setError("");
    } catch (e) {
      setError(e?.message || "Failed to load notification data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authChecked && user?.role === "admin") loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user]);

  async function saveSettings() {
    setSaving(true); setError("");
    try {
      const res = await base44.functions.invoke("saveOwnerNotificationSettings", form);
      if (res?.data?.error) setError(res.data.error);
      else if (res?.data?.settings) {
        setSettings(res.data.settings);
        setForm({
          recipient_email: res.data.settings.recipient_email || "",
          master_enabled: res.data.settings.master_enabled ?? false,
          signup_enabled: res.data.settings.signup_enabled ?? true,
          claim_enabled: res.data.settings.claim_enabled ?? true,
          verdict_enabled: res.data.settings.verdict_enabled ?? true
        });
      }
    } catch (e) {
      setError(e?.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true); setError("");
    try {
      const res = await base44.functions.invoke("sendOwnerNotificationTest", {});
      if (res?.data?.error) setError(res.data.error);
      await loadData();
    } catch (e) {
      setError(e?.message || "Test failed.");
    } finally {
      setTesting(false);
    }
  }

  async function manualRetry(eventId) {
    setRetrying(eventId); setError("");
    try {
      const res = await base44.functions.invoke("retryOwnerNotification", { event_id: eventId });
      if (res?.data?.error) setError(res.data.error);
      await loadData();
    } catch (e) {
      setError(e?.message || "Retry failed.");
    } finally {
      setRetrying(null);
    }
  }

  async function retryAllDue() {
    setRetryingAll(true); setError("");
    try {
      const res = await base44.functions.invoke("deliverOwnerNotifications", {});
      if (res?.data?.error) setError(res.data.error);
      await loadData();
    } catch (e) {
      setError(e?.message || "Batch retry failed.");
    } finally {
      setRetryingAll(false);
    }
  }

  if (!authChecked) return <div className="mx-auto max-w-md px-4 pt-24 text-center font-mono text-base text-court-ice animate-blink">Checking credentials…</div>;
  if (!user) return <AccessDenied message="Sign in to access the notification dashboard." />;
  if (user.role !== "admin") return <AccessDenied message="Admin access required." />;

  const stats = outbox?.stats || { pending: 0, processing: 0, sent: 0, failed: 0, dead_letter: 0, total: 0 };
  const recent = outbox?.recent || [];

  return (
    <section className="mx-auto max-w-4xl px-4 pt-8 sm:pt-12 pb-20">
      <header className="mb-6">
        <h1 className="font-display uppercase leading-[0.86] text-court-ice" style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)" }}>
          Owner Notifications
        </h1>
        <p className="mt-2 font-mono text-base text-court-ice leading-relaxed">
          Email alerts for signups, wallet claims, and live verdicts. Exactly-once delivery with bounded retry.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-4 py-3 text-sm text-court-red mb-4">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="font-mono leading-relaxed">{error}</span>
        </div>
      )}

      {/* Settings */}
      <div className="border-2 border-court-uv bg-court-navy p-4 sm:p-5 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Settings className="h-5 w-5 text-court-chart" />
          <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg">Settings</h2>
        </div>

        <label className="block mb-4">
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute block mb-1">Recipient Email</span>
          <input
            type="email"
            value={form.recipient_email}
            onChange={(e) => setForm({ ...form, recipient_email: e.target.value })}
            placeholder="owner@example.com"
            className="court-input w-full px-3 py-2 font-mono text-sm"
          />
        </label>

        <div className="grid sm:grid-cols-2 gap-3 mb-4">
          <ToggleRow label="Master Enable" checked={form.master_enabled} onChange={(v) => setForm({ ...form, master_enabled: v })} />
          <ToggleRow label="Signup Alerts" checked={form.signup_enabled} onChange={(v) => setForm({ ...form, signup_enabled: v })} />
          <ToggleRow label="Claim Alerts" checked={form.claim_enabled} onChange={(v) => setForm({ ...form, claim_enabled: v })} />
          <ToggleRow label="Verdict Alerts" checked={form.verdict_enabled} onChange={(v) => setForm({ ...form, verdict_enabled: v })} />
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={saveSettings}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings className="h-4 w-4" />} Save Settings
          </button>
          <button
            type="button"
            onClick={sendTest}
            disabled={testing}
            className="inline-flex items-center gap-2 border-2 border-court-ice text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 hover:bg-court-uv transition-colors disabled:opacity-60"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send Test Email
          </button>
        </div>

        {/* Last test result */}
        {settings?.last_test_timestamp && (
          <div className="mt-4 border-t-2 border-court-mute/30 pt-3">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-1">Last Test</p>
            <p className="font-mono text-sm text-court-ice">
              {settings.last_test_status === "success" ? (
                <span className="text-court-chart">✓ Success</span>
              ) : (
                <span className="text-court-red">✗ {settings.last_test_error || "Failed"}</span>
              )}
              <span className="text-court-mute ml-2">{new Date(settings.last_test_timestamp).toLocaleString()}</span>
            </p>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <Stat label="Pending" value={stats.pending} />
        <Stat label="Processing" value={stats.processing} />
        <Stat label="Sent" value={stats.sent} accent />
        <Stat label="Failed" value={stats.failed} />
        <Stat label="Dead Letter" value={stats.dead_letter} danger />
      </div>

      {/* Retry Due Events */}
      <div className="flex items-center gap-3 mb-4">
        <button
          type="button"
          onClick={retryAllDue}
          disabled={retryingAll}
          className="inline-flex items-center gap-2 border-2 border-court-chart text-court-chart font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 hover:bg-court-chart hover:text-court-navy transition-colors disabled:opacity-60"
        >
          {retryingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />} Retry Due Events
        </button>
      </div>

      {/* Recent events */}
      <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">Recent Events</h2>
      {loading ? (
        <p className="font-mono text-base text-court-ice animate-blink">Loading…</p>
      ) : recent.length === 0 ? (
        <p className="font-mono text-base text-court-mute">No notification events yet.</p>
      ) : (
        <div className="overflow-x-auto border-2 border-court-ice">
          <table className="w-full font-mono text-xs">
            <thead className="bg-court-uv text-court-ice uppercase tracking-[0.1em]">
              <tr>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Attempts</th>
                <th className="text-left p-2">Error</th>
                <th className="text-left p-2">Created</th>
                <th className="text-left p-2">Retry</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.event_id} className="border-t border-court-mute/40 text-court-ice">
                  <td className="p-2 uppercase">{e.event_type}</td>
                  <td className={cn("p-2 uppercase", e.status === "sent" ? "text-court-chart" : e.status === "dead_letter" ? "text-court-red" : "text-court-ice")}>{e.status}</td>
                  <td className="p-2">{e.attempt_count}/{e.max_attempts}</td>
                  <td className="p-2 text-court-mute truncate max-w-[12rem]">{e.last_error || "—"}</td>
                  <td className="p-2 text-court-mute whitespace-nowrap">{e.created_at ? new Date(e.created_at).toLocaleString() : "—"}</td>
                  <td className="p-2">
                    {e.status !== "sent" && (
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
        <Link to="/admin/calibration-docket" className="inline-flex items-center gap-2 text-court-chart font-display uppercase tracking-[0.08em] text-sm hover:brightness-110">
          ← Back to Calibration Docket
        </Link>
      </div>
    </section>
  );
}

function ToggleRow({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between gap-3 border-2 border-court-mute/30 px-3 py-2.5 cursor-pointer hover:border-court-ice transition-colors">
      <span className="font-mono text-sm text-court-ice">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 rounded-full border-2 transition-colors", checked ? "bg-court-chart border-court-chart" : "bg-court-navy border-court-mute")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-court-navy transition-transform", checked ? "left-5" : "left-0.5")} />
      </button>
    </label>
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