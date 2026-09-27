import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { AlertTriangle, Loader2, Save, Check, Power, ShieldAlert, Activity, Coins, Clock, History } from "lucide-react";

export default function AdminWalletTrialUsage() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [policy, setPolicy] = useState(null);
  const [calibrationCeiling, setCalibrationCeiling] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [form, setForm] = useState({
    enabled: true,
    daily_call_limit: 500,
    emergency_stop: false
  });

  useEffect(() => {
    (async () => {
      try { setUser(await base44.auth.me()); } catch { setUser(null); } finally { setAuthChecked(true); }
    })();
  }, []);

  async function loadPolicy() {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("getWalletTrialUsageStatus", {});
      if (res?.data?.error) { setError(res.data.error); }
      else {
        if (res?.data?.policy) {
          setPolicy(res.data.policy);
          setForm({
            enabled: res.data.policy.enabled ?? true,
            daily_call_limit: res.data.policy.daily_call_limit ?? 500,
            emergency_stop: res.data.policy.emergency_stop ?? false
          });
        }
        if (res?.data?.calibration_ceiling) {
          setCalibrationCeiling(res.data.calibration_ceiling);
        }
      }
    } catch (e) {
      setError(e?.message || "Failed to load usage policy.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authChecked && user?.role === "admin") loadPolicy();
  }, [authChecked, user]);

  async function save() {
    setSaving(true); setError(""); setSavedFlash(false);
    try {
      const res = await base44.functions.invoke("saveWalletTrialUsagePolicy", form);
      if (res?.data?.error) { setError(res.data.error); }
      else if (res?.data?.policy) {
        setPolicy(res.data.policy);
        setForm({
          enabled: res.data.policy.enabled ?? true,
          daily_call_limit: res.data.policy.daily_call_limit ?? 500,
          emergency_stop: res.data.policy.emergency_stop ?? false
        });
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 3500);
      }
    } catch (e) {
      setError(e?.message || "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const isDirty = policy ? (
    form.enabled !== policy.enabled ||
    Number(form.daily_call_limit) !== Number(policy.daily_call_limit) ||
    form.emergency_stop !== policy.emergency_stop
  ) : true;

  if (!authChecked) return <div className="mx-auto max-w-md px-4 pt-24 text-center font-mono text-base text-court-ice animate-blink">Checking credentials…</div>;
  if (!user) return <AccessDenied message="Sign in to access the admin dashboard." />;
  if (user.role !== "admin") return <AccessDenied message="Admin access required." />;

  const remaining = policy?.remaining_today ?? 0;
  const reserved = policy?.calls_reserved ?? 0;
  const completed = policy?.calls_completed ?? 0;
  const inFlight = policy?.in_flight ?? 0;
  const limit = policy?.daily_call_limit ?? 500;

  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:pt-10 pb-20">
      <header className="mb-5">
        <div className="flex items-center gap-2 mb-1">
          <Coins className="h-5 w-5 text-court-chart" />
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-court-mute">Admin · Whole Wallet Production</span>
        </div>
        <h1 className="font-display uppercase leading-[0.86] text-court-ice" style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.4rem)" }}>
          Whole Wallet Production Budget
        </h1>
        <p className="mt-1.5 font-mono text-sm text-court-mute leading-relaxed">
          Independent daily budget for ordinary whole-wallet production trials. Does NOT use the legacy 1,020 calibration ceiling.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-2.5 text-sm text-court-red mb-4">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="font-mono leading-relaxed">{error}</span>
        </div>
      )}

      {/* ---- Status cards ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        <StatCard icon={Power} label="Enabled" value={policy?.enabled ? "YES" : "NO"} accent={policy?.enabled} />
        <StatCard icon={ShieldAlert} label="Emergency Stop" value={policy?.emergency_stop ? "ACTIVE" : "OFF"} danger={policy?.emergency_stop} />
        <StatCard icon={Activity} label="Reserved Today (UTC)" value={`${reserved} / ${limit}`} />
        <StatCard icon={Check} label="Remaining" value={String(remaining)} accent={remaining > 0} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
        <StatCard icon={Check} label="Completed Today" value={String(completed)} />
        <StatCard icon={Clock} label="In-Flight" value={String(inFlight)} />
        <StatCard icon={Clock} label="UTC Reset" value={policy?.usage_date || "—"} />
      </div>

      {/* ---- Settings ---- */}
      <div className="border-2 border-court-uv bg-court-navy mb-6">
        <div className="flex items-center justify-between border-b-2 border-court-uv px-4 sm:px-5 py-3">
          <h2 className="font-display uppercase tracking-[0.08em] text-court-chart text-base">Settings</h2>
          {saving ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-court-mute"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…</span>
          ) : savedFlash ? (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-court-chart"><Check className="h-3.5 w-3.5" /> Saved</span>
          ) : isDirty ? (
            <span className="font-mono text-xs text-court-chart/90">Unsaved changes</span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-mono text-xs text-court-mute/70"><Check className="h-3.5 w-3.5" /> All saved</span>
          )}
        </div>

        <div className="px-4 sm:px-5 py-4 space-y-5">
          {/* Enabled toggle */}
          <ToggleRow
            label="Enabled"
            description="Master switch for ordinary whole-wallet production trials. When off, no production Nansen calls are permitted."
            checked={form.enabled}
            onChange={(v) => setForm({ ...form, enabled: v })}
            prominent
          />

          {/* Emergency stop */}
          <div className={cn("border-2 px-3.5 py-3", form.emergency_stop ? "border-court-red bg-court-red/10" : "border-court-mute/25")}>
            <ToggleRow
              label="Emergency Stop"
              description="Kill switch. When on, all production whole-wallet Nansen calls are immediately blocked."
              checked={form.emergency_stop}
              onChange={(v) => setForm({ ...form, emergency_stop: v })}
              danger
            />
          </div>

          {/* Numeric field */}
          <NumberField
            label="Daily Call Limit"
            value={form.daily_call_limit}
            onChange={(v) => setForm({ ...form, daily_call_limit: v })}
            min={1} max={10000}
          />

          {/* Save */}
          <button
            type="button"
            onClick={save}
            disabled={saving || !isDirty}
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Settings
          </button>
        </div>
      </div>

      {/* ---- Legacy calibration ceiling (historical/completed) ---- */}
      {calibrationCeiling && (
        <div className="border-2 border-court-mute/30 bg-court-navy/60 mb-6">
          <div className="flex items-center gap-2 border-b-2 border-court-mute/30 px-4 sm:px-5 py-3">
            <History className="h-4 w-4 text-court-mute" />
            <h2 className="font-display uppercase tracking-[0.08em] text-court-mute text-sm">Legacy Calibration Ceiling · Historical/Completed</h2>
          </div>
          <div className="px-4 sm:px-5 py-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-court-mute/80 mb-1">Ceiling</p>
                <p className="font-display text-lg text-court-ice">{calibrationCeiling.ceiling}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-court-mute/80 mb-1">Verified Total (Capped)</p>
                <p className="font-display text-lg text-court-ice">{calibrationCeiling.verified_total_capped ?? "—"}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-court-mute/80 mb-1">Status</p>
                <p className={cn("font-display text-lg", calibrationCeiling.ceiling_exceeded ? "text-court-red" : "text-court-chart")}>
                  {calibrationCeiling.ceiling_exceeded ? "EXCEEDED" : "OK"}
                </p>
              </div>
            </div>
            <p className="mt-3 font-mono text-xs text-court-mute/70 leading-relaxed">
              {calibrationCeiling.note} This ceiling is permanently exhausted and is NOT available production capacity.
            </p>
          </div>
        </div>
      )}

      <div className="text-center">
        <Link to="/admin/contest-control" className="inline-flex items-center gap-2 text-court-chart font-display uppercase tracking-[0.08em] text-sm hover:brightness-110">
          ← Back to Contest Control
        </Link>
      </div>
    </section>
  );
}

function StatCard({ icon: Icon, label, value, accent, danger }) {
  return (
    <div className="border-2 border-court-mute/25 bg-court-navy/60 px-3 py-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className={cn("h-3.5 w-3.5", danger ? "text-court-red" : accent ? "text-court-chart" : "text-court-mute")} />
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-court-mute/80">{label}</p>
      </div>
      <p className={cn("font-display text-lg leading-none", danger ? "text-court-red" : accent ? "text-court-chart" : "text-court-ice/90")}>{value}</p>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange, prominent, danger }) {
  return (
    <label className="flex items-center justify-between gap-3 cursor-pointer group">
      <div className="min-w-0">
        <span className={cn("font-mono text-sm block", prominent ? "text-court-ice font-semibold" : "text-court-ice")}>{label}</span>
        {description && <span className="font-mono text-xs text-court-mute/80 block leading-relaxed">{description}</span>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={cn("relative h-6 w-11 rounded-full border-2 transition-colors shrink-0",
          danger ? (checked ? "bg-court-red border-court-red" : "bg-court-navy border-court-mute/60") : (checked ? "bg-court-chart border-court-chart" : "bg-court-navy border-court-mute/60")
        )}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full transition-transform", checked ? (danger ? "left-5 bg-court-navy" : "left-5 bg-court-navy") : "left-0.5 bg-court-mute")} />
      </button>
    </label>
  );
}

function NumberField({ label, value, onChange, min, max }) {
  return (
    <div>
      <label className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute block mb-1.5">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        min={min}
        max={max}
        className="court-input w-full px-3 py-2.5 font-mono text-sm focus:outline-none"
      />
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