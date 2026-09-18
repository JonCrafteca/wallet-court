import { useState } from "react";
import { manageHandle } from "@/lib/walletClaim";
import { Loader2, Eye, EyeOff, Trash2, Plus, ShieldAlert } from "lucide-react";

const PROVIDERS = [
  { id: "x", label: "X", placeholder: "handle (no @)" },
  { id: "fomo", label: "FOMO", placeholder: "handle" },
  { id: "pump_fun", label: "Pump.fun", placeholder: "handle" }
];

export default function HandleManager({ claimSlug, handles, onChanged }) {
  const [provider, setProvider] = useState("x");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    setBusy(true);
    setError("");
    try {
      const res = await manageHandle(claimSlug, "add", provider, handle);
      if (res?.error) {
        setError(res.error);
      } else {
        setHandle("");
        if (onChanged) onChanged(res.handles);
      }
    } catch (e) {
      setError(e?.message || "Failed to add handle.");
    } finally {
      setBusy(false);
    }
  }

  async function doAction(action, prov) {
    setBusy(true);
    setError("");
    try {
      const res = await manageHandle(claimSlug, action, prov);
      if (res?.error) setError(res.error);
      else if (onChanged) onChanged(res.handles);
    } catch (e) {
      setError(e?.message || "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute block mb-1">
        Social Handles
      </label>
      <p className="font-mono text-xs text-court-mute mb-3 leading-relaxed">
        Self-reported · Unverified. Wallet Court never infers handles from onchain activity.
      </p>

      {handles && handles.length > 0 && (
        <div className="space-y-2 mb-3">
          {handles.map((h) => (
            <div key={h.provider} className="flex items-center gap-2 border-2 border-court-ice bg-court-navy px-3 py-2">
              <span className="font-mono text-xs uppercase text-court-chart w-16">{h.provider_label}</span>
              <span className="font-mono text-sm text-court-ice flex-1 truncate">@{h.display_handle}</span>
              <span className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-court-mute border border-court-mute px-1.5 py-0.5">
                {h.verification_state === "verified" ? "Verified" : "Unverified"}
              </span>
              <button onClick={() => doAction("remove", h.provider)} disabled={busy} aria-label={`Remove ${h.provider_label} handle`} className="text-court-red hover:text-court-ice p-1 disabled:opacity-50">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className="court-input px-2 py-2 font-mono text-sm border-2"
          aria-label="Platform"
        >
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder={PROVIDERS.find((p) => p.id === provider)?.placeholder}
          className="flex-1 min-w-[120px] court-input px-3 py-2 font-mono text-sm"
          aria-label="Handle"
        />
        <button onClick={add} disabled={busy || !handle.trim()} className="inline-flex items-center gap-1 bg-court-chart text-court-navy font-display uppercase tracking-[0.06em] text-sm px-3 py-2 border-2 border-court-navy disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
        </button>
      </div>
      {error && <p className="font-mono text-sm text-court-red mt-2" role="alert">{error}</p>}
    </div>
  );
}