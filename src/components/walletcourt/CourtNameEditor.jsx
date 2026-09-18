import { useState } from "react";
import { setCourtName } from "@/lib/walletClaim";
import { Pencil, Loader2, Check } from "lucide-react";

export default function CourtNameEditor({ claim, onUpdated }) {
  const [value, setValue] = useState(claim.court_name || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setMsg("");
    setError("");
    try {
      const res = await setCourtName(claim.claim_slug, value);
      if (res?.error) {
        setError(res.error);
      } else {
        setMsg("Court Name saved.");
        if (onUpdated) onUpdated(res.claim);
      }
    } catch (e) {
      setError(e?.message || "Save failed.");
    } finally {
      setBusy(false);
      setTimeout(() => { setMsg(""); setError(""); }, 3000);
    }
  }

  return (
    <div>
      <label className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute block mb-1">
        Court Name
      </label>
      <p className="font-mono text-xs text-court-mute mb-2 leading-relaxed">
        3–24 characters. Letters, numbers, underscores, hyphens. Must start and end with a letter or number. Changeable once every 30 days.
      </p>
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, 24))}
          maxLength={24}
          placeholder="e.g. DegenSupreme"
          className="flex-1 court-input px-3 py-2 font-mono text-sm"
          aria-label="Court Name"
        />
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-1 bg-court-chart text-court-navy font-display uppercase tracking-[0.06em] text-sm px-3 py-2 border-2 border-court-navy disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />} Save
        </button>
      </div>
      {msg && <p className="font-mono text-sm text-court-chart mt-2" role="status"><Check className="inline h-3.5 w-3.5 mr-1" />{msg}</p>}
      {error && <p className="font-mono text-sm text-court-red mt-2" role="alert">{error}</p>}
    </div>
  );
}