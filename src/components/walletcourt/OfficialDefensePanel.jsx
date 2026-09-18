import { useState } from "react";
import { submitDefense, hideDefense } from "@/lib/walletClaim";
import { Loader2, ShieldCheck, EyeOff, FileText } from "lucide-react";

export default function OfficialDefensePanel({ claimSlug, publicDefense, ownerDefenses, isOwner, onChanged }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await submitDefense(claimSlug, text);
      if (res?.error) {
        setError(res.error);
      } else {
        setMsg("Defense submitted for review.");
        setText("");
        if (onChanged) onChanged();
      }
    } catch (e) {
      setError(e?.message || "Submission failed.");
    } finally {
      setBusy(false);
      setTimeout(() => { setMsg(""); setError(""); }, 3000);
    }
  }

  async function hide() {
    setBusy(true);
    setError("");
    try {
      const res = await hideDefense(claimSlug);
      if (res?.error) setError(res.error);
      else if (onChanged) onChanged();
    } catch (e) {
      setError(e?.message || "Hide failed.");
    } finally {
      setBusy(false);
    }
  }

  const remaining = 280 - Array.from(text.trim()).length;

  // Public view: show the latest approved defense.
  if (!isOwner) {
    if (!publicDefense) return null;
    return (
      <div className="border-2 border-court-chart bg-court-navy p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-5 w-5 text-court-chart" />
          <span className="font-display uppercase tracking-[0.06em] text-court-chart text-base">Official Defense · Verified Wallet Owner</span>
        </div>
        <p className="font-mono text-court-ice leading-relaxed text-base whitespace-pre-wrap">{publicDefense.text}</p>
        <p className="font-mono text-xs text-court-mute mt-3 leading-relaxed">
          The defense is owner-submitted and does not alter the court's verdict or evidence.
        </p>
      </div>
    );
  }

  // Owner view: manage defenses.
  return (
    <div>
      <label className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute block mb-1">
        Official Defense
      </label>
      <p className="font-mono text-xs text-court-mute mb-2 leading-relaxed">
        Max 280 characters. Plain text only. Submissions are reviewed before they appear publicly. Does not alter the verdict or evidence.
      </p>

      {publicDefense && (
        <div className="border-2 border-court-chart bg-court-navy p-3 mb-3">
          <p className="font-mono text-xs uppercase tracking-[0.1em] text-court-chart mb-1">Currently Public</p>
          <p className="font-mono text-court-ice text-sm leading-relaxed whitespace-pre-wrap">{publicDefense.text}</p>
          <button onClick={hide} disabled={busy} className="mt-2 inline-flex items-center gap-1 font-mono text-xs uppercase tracking-[0.08em] text-court-red hover:text-court-ice disabled:opacity-50">
            <EyeOff className="h-3.5 w-3.5" /> Hide immediately
          </button>
        </div>
      )}

      {ownerDefenses && ownerDefenses.length > 0 && (
        <div className="space-y-1.5 mb-3 max-h-40 overflow-y-auto">
          {ownerDefenses.map((d) => (
            <div key={d.version} className="flex items-start gap-2 border border-court-mute/40 px-3 py-2">
              <span className="font-mono text-xs text-court-mute shrink-0">v{d.version}</span>
              <span className="font-mono text-xs text-court-ice flex-1 truncate">{d.text}</span>
              <span className={`font-mono text-[0.6rem] uppercase tracking-[0.1em] px-1.5 py-0.5 shrink-0 ${
                d.moderation_status === "approved" ? "text-court-chart border border-court-chart" :
                d.moderation_status === "pending" ? "text-court-mute border border-court-mute" :
                d.moderation_status === "rejected" ? "text-court-red border border-court-red" :
                "text-court-mute border border-court-mute"
              }`}>{d.moderation_status}</span>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={280}
        rows={3}
        placeholder="Your official defense, in your own words…"
        className="w-full court-input px-3 py-2 font-mono text-sm resize-none"
        aria-label="Official Defense text"
      />
      <div className="flex items-center justify-between mt-1">
        <span className="font-mono text-xs text-court-mute">{remaining} characters remaining</span>
        <button onClick={submit} disabled={busy || !text.trim()} className="inline-flex items-center gap-1 bg-court-chart text-court-navy font-display uppercase tracking-[0.06em] text-sm px-3 py-2 border-2 border-court-navy disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Submit for Review
        </button>
      </div>
      {msg && <p className="font-mono text-sm text-court-chart mt-2" role="status">{msg}</p>}
      {error && <p className="font-mono text-sm text-court-red mt-2" role="alert">{error}</p>}
    </div>
  );
}