import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2, Send, RotateCw, Mail, Settings, Check, Bell, UserPlus, KeyRound, Gavel, CircleAlert } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formMatchesSettings(form, s) {
  if (!s) return false;
  return (
    (form.recipient_email || "") === (s.recipient_email || "") &&
    !!form.master_enabled === !!s.master_enabled &&
    !!form.signup_enabled === !!s.signup_enabled &&
    !!form.claim_enabled === !!s.claim_enabled &&
    !!form.verdict_enabled === !!s.verdict_enabled
  );
}

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
  const [savedFlash, setSavedFlash] = useState(false);
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
    setSaving(true); setError(""); setSavedFlash(false);
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
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 3500);
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

  const isDirty = !formMatchesSettings(form, settings);
  const savedEmailValid = !!(settings?.recipient_email && EMAIL_RE.test(settings.recipient_email));
  const canSendTest = savedEmailValid && !isDirty && !testing;
  const testDisabledReason = !savedEmailValid
    ? "Save a valid recipient email first"
    : isDirty
      ? "Save your changes first"
      : null;

  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:pt-10 pb-20">
      <header className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="h-5 w-5 text-court-chart" />
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-court-mute">Admin · Notifications</span>
        </div>
        <h1 className="font-display uppercase leading-[0.86] text-court-ice" style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.4rem)" }}>
          Owner Notifications
        </h1>
        <p className="mt-1.5 font-mono text-sm text-court-mute leading-relaxed">
          Email alerts for signups, wallet claims, and live verdicts. Exactly-once delivery with bounded retry.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-2.5 text-sm text-court-red mb-4">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="font-mono leading-relaxed">{error}</span>
        </div>
      )}

      {/* ---- Settings card ---- */}
      <div className="border-2 border-court-uv bg-court-navy mb-8">
        <div className="flex items-center justify-between border-b-2 border-court-uv px-4 sm:px-5 py-3">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-court-chart" />
            <h2 className="font-display uppercase tracking-[0.08em] text-court-chart text-base">Settings</h2>
          </div>
          {/* Saved / unsaved indicator */}
          <SaveStatus isDirty={isDirty} savedFlash={savedFlash} saving={saving} />
        </div>

        <div className="px-4 sm:px-5 py-4 space-y-5">
          {/* Recipient email */}
          <div>
            <label htmlFor="recipient_email" className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute block mb-1.5">
              Recipient Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-court-mute pointer-events-none" />
              <input
                id="recipient_email"
                type="email"
                value={form.recipient_email}
                onChange={(e) => setForm({ ...form, recipient_email: e.target.value })}
                placeholder="owner@example.com"
                className="court-input w-full pl-9 pr-3 py-2.5 font-mono text-sm focus:outline-none"
              />
            </div>
            <p className="mt-1 font-mono text-xs text-court-mute/80">
              All notification emails are sent to this address.
            </p>
          </div>

          {/* Master switch */}
          <div className={cn(
            "border-2 px-3.5 py-3 transition-colors",
            form.master_enabled ? "border-court-chart/60 bg-court-chart/5" : "border-court-mute/25"
          )}>
            <ToggleRow
              label="Master Enable"
              description="Turn on all owner email notifications. When off, no emails are sent."
              checked={form.master_enabled}
              onChange={(v) => setForm({ ...form, master_enabled: v })}
              prominent
            />
          </div>

          {/* Event toggles group */}
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">Event Alerts</p>
            <div className="border-2 border-court-mute/25 divide-y-2 divide-court-mute/20">
              <ToggleRow
                label="Signup Alerts"
                description="New account registrations."
                icon={UserPlus}
                checked={form.signup_enabled}
                onChange={(v) => setForm({ ...form, signup_enabled: v })}
              />
              <ToggleRow
                label="Claim Alerts"
                description="Wallet ownership verified."
                icon={KeyRound}
                checked={form.claim_enabled}
                onChange={(v) => setForm({ ...form, claim_enabled: v })}
              />
              <ToggleRow
                label="Verdict Alerts"
                description="Live verdicts issued."
                icon={Gavel}
                checked={form.verdict_enabled}
                onChange={(v) => setForm({ ...form, verdict_enabled: v })}
              />
            </div>
          </div>

          {/* Action row: Save + Test */}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving || !isDirty}
              className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save Settings
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={sendTest}
                disabled={!canSendTest}
                title={testDisabledReason || "Send a test email"}
                className="inline-flex items-center gap-2 border-2 border-court-ice text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 hover:bg-court-uv transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send Test Email
              </button>
              {/* Last test result beside the button */}
              <LastTestResult settings={settings} />
            </div>
          </div>

          {/* Test disabled hint */}
          {!canSendTest && testDisabledReason && (
            <p className="flex items-center gap-1.5 font-mono text-xs text-court-mute/80 -mt-2">
              <CircleAlert className="h-3.5 w-3.5" />
              {testDisabledReason}
            </p>
          )}
        </div>
      </div>

      {/* ---- Delivery (reduced visual weight) ---- */}
      <div className="mb-4">
        <h2 className="font-display uppercase tracking-[0.08em] text-court-ice/80 text-sm mb-2.5">Delivery</h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
          <MiniStat label="Pending" value={stats.pending} />
          <MiniStat label="Processing" value={stats.processing} />
          <MiniStat label="Sent" value={stats.sent} accent />
          <MiniStat label="Failed" value={stats.failed} />
          <MiniStat label="Dead Letter" value={stats.dead_letter} danger />
        </div>

        <button
          type="button"
          onClick={retryAllDue}
          disabled={retryingAll}
          className="inline-flex items-center gap-2 border-2 border-court-chart/70 text-court-chart font-display uppercase tracking-[0.08em] text-xs px-3 py-2 hover:bg-court-chart hover:text-court-navy transition-colors disabled:opacity-50"
        >
          {retryingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />} Retry Due Events
        </button>
      </div>

      {/* Recent events */}
      <div>
        <h2 className="font-display uppercase tracking-[0.08em] text-court-ice/80 text-sm mb-2.5">Recent Events</h2>
        {loading ? (
          <p className="font-mono text-sm text-court-ice/70 animate-blink">Loading…</p>
        ) : recent.length === 0 ? (
          <p className="font-mono text-sm text-court-mute/70">No notification events yet.</p>
        ) : (
          <div className="overflow-x-auto border-2 border-court-mute/25">
            <table className="w-full font-mono text-xs">
              <thead className="bg-court-uv/60 text-court-ice/80 uppercase tracking-[0.1em]">
                <tr>
                  <th className="text-left p-2 font-medium">Type</th>
                  <th className="text-left p-2 font-medium">Case</th>
                  <th className="text-left p-2 font-medium">Status</th>
                  <th className="text-left p-2 font-medium">Attempts</th>
                  <th className="text-left p-2 font-medium">Error</th>
                  <th className="text-left p-2 font-medium">Created</th>
                  <th className="text-left p-2 font-medium">Retry</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => (
                  <tr key={e.event_id} className="border-t border-court-mute/20 text-court-ice/90">
                    <td className="p-2 uppercase">{e.event_type}</td>
                    <td className="p-2">
                      {e.public_slug ? (
                        <Link to={`/case/${e.public_slug}`} className="text-court-chart hover:brightness-110 underline underline-offset-2 break-all">{e.public_slug}</Link>
                      ) : (
                        <span className="text-court-mute/60">—</span>
                      )}
                    </td>
                    <td className={cn("p-2 uppercase", e.status === "sent" ? "text-court-chart" : e.status === "dead_letter" ? "text-court-red" : "text-court-ice/90")}>{e.status}</td>
                    <td className="p-2">{e.attempt_count}/{e.max_attempts}</td>
                    <td className="p-2 text-court-mute truncate max-w-[10rem]">{e.last_error || "—"}</td>
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
      </div>

      <div className="mt-8 text-center">
        <Link to="/admin/calibration-docket" className="inline-flex items-center gap-2 text-court-chart font-display uppercase tracking-[0.08em] text-sm hover:brightness-110">
          ← Back to Calibration Docket
        </Link>
      </div>
    </section>
  );
}

function SaveStatus({ isDirty, savedFlash, saving }) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-court-mute">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );
  }
  if (savedFlash) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-court-chart">
        <Check className="h-3.5 w-3.5" /> Settings saved
      </span>
    );
  }
  if (isDirty) {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-court-chart/90">
        <CircleAlert className="h-3.5 w-3.5" /> Unsaved changes
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-court-mute/70">
      <Check className="h-3.5 w-3.5" /> All changes saved
    </span>
  );
}

function LastTestResult({ settings }) {
  if (!settings?.last_test_timestamp) {
    return <span className="font-mono text-xs text-court-mute/60">No test sent</span>;
  }
  const ok = settings.last_test_status === "success";
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs", ok ? "text-court-chart" : "text-court-red")}>
      {ok ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {ok ? "Test passed" : (settings.last_test_error || "Test failed")}
      <span className="text-court-mute/70 ml-1">{new Date(settings.last_test_timestamp).toLocaleString()}</span>
    </span>
  );
}

function ToggleRow({ label, description, icon: Icon, checked, onChange, prominent }) {
  return (
    <label className={cn("flex items-center justify-between gap-3 cursor-pointer group", prominent ? "py-0" : "px-3.5 py-2.5 hover:bg-court-uv/30 transition-colors")}>
      <div className="flex items-start gap-2.5 min-w-0">
        {Icon && <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", checked ? "text-court-chart" : "text-court-mute")} />}
        <div className="min-w-0">
          <span className={cn("font-mono text-sm block", prominent ? "text-court-ice font-semibold" : "text-court-ice")}>{label}</span>
          {description && <span className="font-mono text-xs text-court-mute/80 block leading-relaxed">{description}</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={cn("relative h-6 w-11 rounded-full border-2 transition-colors shrink-0", checked ? "bg-court-chart border-court-chart" : "bg-court-navy border-court-mute/60 group-hover:border-court-mute")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full transition-transform", checked ? "left-5 bg-court-navy" : "left-0.5 bg-court-mute")} />
      </button>
    </label>
  );
}

function MiniStat({ label, value, accent, danger }) {
  return (
    <div className="border-2 border-court-mute/25 bg-court-navy/60 px-2.5 py-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-court-mute/80 mb-0.5">{label}</p>
      <p className={cn("font-display text-lg leading-none", accent ? "text-court-chart" : danger ? "text-court-red" : "text-court-ice/90")}>{value}</p>
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