import { useState } from "react";
import { updateProfile } from "@/lib/walletClaim";
import { trackClaim, CLAIM_EVENTS } from "@/lib/claimAnalytics";
import { cn } from "@/lib/utils";
import CourtNameEditor from "./CourtNameEditor";
import HandleManager from "./HandleManager";
import OfficialDefensePanel from "./OfficialDefensePanel";
import RevokeClaimSection from "./RevokeClaimSection";
import { Loader2 } from "lucide-react";

const VIS = [
  { id: "private", label: "Private", desc: "Visible only to you." },
  { id: "unlisted", label: "Unlisted", desc: "By link, not discoverable." },
  { id: "public", label: "Public", desc: "Linkable, future honors." }
];

function Toggle({ label, on, onToggle, disabled }) {
  return (
    <button type="button" onClick={onToggle} disabled={disabled} className="inline-flex items-center gap-2 font-mono text-sm text-court-ice disabled:opacity-60">
      <span className={cn("h-5 w-9 rounded-full border-2 relative transition-colors", on ? "bg-court-chart border-court-chart" : "bg-court-navy border-court-mute")}>
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-court-ice transition-all", on ? "left-4" : "left-0.5")} />
      </span>
      <span>{label}</span>
    </button>
  );
}

export default function RapSheetOwnerControls({ data, onReload }) {
  const claim = data.owner_claim || {};
  const [visibility, setVisibility] = useState(claim.profile_visibility || "private");
  const [showHistory, setShowHistory] = useState(!!claim.show_trial_history);
  const [showBadges, setShowBadges] = useState(claim.show_badges !== false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmSeal, setConfirmSeal] = useState(false);

  async function saveVisibility(v) {
    const prev = visibility;
    setVisibility(v);
    setBusy(true);
    setMsg("");
    try {
      const res = await updateProfile(claim.claim_slug, { profile_visibility: v });
      if (res?.error) { setVisibility(prev); setMsg(res.error); return; }
      trackClaim(CLAIM_EVENTS.VISIBILITY_CHANGED, { visibility: v });
      setMsg("Visibility updated.");
      if (onReload) onReload();
    } catch (e) {
      setVisibility(prev);
      setMsg(e?.message || "Save failed.");
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(""), 2500);
    }
  }

  async function toggleHistory() {
    const n = !showHistory;
    setShowHistory(n);
    setBusy(true);
    try {
      await updateProfile(claim.claim_slug, { show_trial_history: n });
      if (onReload) onReload();
    } catch { setShowHistory(!n); }
    finally { setBusy(false); }
  }

  async function toggleBadges() {
    const n = !showBadges;
    setShowBadges(n);
    setBusy(true);
    try {
      await updateProfile(claim.claim_slug, { show_badges: n });
      if (onReload) onReload();
    } catch { setShowBadges(!n); }
    finally { setBusy(false); }
  }

  async function sealProfile() {
    setConfirmSeal(false);
    setBusy(true);
    try {
      const res = await updateProfile(claim.claim_slug, { profile_visibility: "private" });
      if (res?.error) { setMsg(res.error); return; }
      setVisibility("private");
      trackClaim(CLAIM_EVENTS.VISIBILITY_CHANGED, { visibility: "private" });
      setMsg("Profile sealed — identity hidden.");
      if (onReload) onReload();
    } catch (e) { setMsg(e?.message || "Seal failed."); }
    finally { setBusy(false); setTimeout(() => setMsg(""), 2500); }
  }

  return (
    <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5">
      <p className="font-display uppercase tracking-[0.06em] text-court-chart text-lg mb-4">Owner Controls</p>
      <div className="space-y-5">
        <CourtNameEditor claim={claim} onUpdated={onReload} />

        <HandleManager claimSlug={data.claim_slug} handles={data.handles || []} onChanged={onReload} />

        <OfficialDefensePanel
          claimSlug={data.claim_slug}
          publicDefense={data.official_defense}
          ownerDefenses={data.owner_defenses}
          isOwner={true}
          onChanged={onReload}
        />

        <div>
          <label className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute block mb-1">Visibility</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {VIS.map((v) => (
              <button key={v.id} type="button" onClick={() => saveVisibility(v.id)} disabled={busy}
                className={cn("text-left p-3 border-2 transition-colors",
                  visibility === v.id ? "bg-court-chart text-court-navy border-court-chart" : "bg-court-navy text-court-ice border-court-ice hover:bg-court-uv")}>
                <span className="block font-display uppercase tracking-[0.04em] text-sm">{v.label}</span>
                <span className={cn("block font-mono text-xs mt-1", visibility === v.id ? "text-court-navy" : "text-court-mute")}>{v.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Toggle label="Show trial history" on={showHistory} onToggle={toggleHistory} disabled={busy} />
          <Toggle label="Show badge cabinet" on={showBadges} onToggle={toggleBadges} disabled={busy} />
        </div>

        <div className="pt-3 border-t border-court-mute/40">
          {!confirmSeal ? (
            <button type="button" onClick={() => setConfirmSeal(true)} className="font-mono text-sm uppercase tracking-[0.1em] text-court-red hover:text-court-ice">
              Hide public identity (make private)
            </button>
          ) : (
            <div className="border-2 border-court-red p-3">
              <p className="font-mono text-sm text-court-ice mb-2">Hide your public identity? Your Rap Sheet will only be visible to you.</p>
              <div className="flex gap-2">
                <button type="button" onClick={sealProfile} disabled={busy} className="bg-court-red text-court-ice font-display uppercase tracking-[0.06em] text-sm px-3 py-2 border-2 border-court-ice">Yes, hide it</button>
                <button type="button" onClick={() => setConfirmSeal(false)} className="font-mono text-sm text-court-mute hover:text-court-ice">Cancel</button>
              </div>
            </div>
          )}
        </div>

        <RevokeClaimSection claimSlug={data.claim_slug} onRevoked={onReload} />

        {busy && <p className="font-mono text-sm text-court-mute"><Loader2 className="inline h-4 w-4 animate-spin mr-1" />Saving…</p>}
        {msg && <p className="font-mono text-sm text-court-chart" role="status">{msg}</p>}
      </div>
    </div>
  );
}