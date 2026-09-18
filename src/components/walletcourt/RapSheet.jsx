import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Gavel, Share2, Copy, Check, AtSign } from "lucide-react";
import { trackClaim, CLAIM_EVENTS } from "@/lib/claimAnalytics";
import BadgeCabinet from "./BadgeCabinet";
import RapSheetOwnerControls from "./RapSheetOwnerControls";
import OfficialDefensePanel from "./OfficialDefensePanel";

function fmtDate(iso) {
  try { return iso ? new Date(iso).toLocaleDateString() : ""; } catch { return ""; }
}

function Stat({ label, value }) {
  return (
    <div className="border-2 border-court-ice bg-court-navy p-3">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mb-1">{label}</p>
      <p className="font-display text-court-ice text-lg break-words leading-tight">{value}</p>
    </div>
  );
}

export default function RapSheet({ data, claimSlug, onReload }) {
  const [copied, setCopied] = useState(false);
  const isOwner = data.is_owner;
  const displayName = data.court_name || data.public_alias || data.address_short || "Anonymous Wallet";
  const rapUrl = typeof window !== "undefined" ? `${window.location.origin}/wallet/${claimSlug}` : "";

  async function share() {
    try {
      await navigator.clipboard.writeText(rapUrl);
      setCopied(true);
      trackClaim(CLAIM_EVENTS.RAP_SHEET_SHARED, { visibility: data.profile_visibility });
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:pt-12 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-[0.14em] mb-8 border-2 border-court-ice bg-court-navy px-4 py-2">
        <span className="text-court-chart font-bold">Rap Sheet</span>
        <span className="text-court-ice">{data.network}</span>
        <span className="text-court-mute">Member since {fmtDate(data.verified_at)}</span>
      </div>

      {/* Identity header */}
      <div className="border-2 border-court-chart bg-court-uv p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="h-5 w-5 text-court-chart" />
          <span className="font-display uppercase tracking-[0.06em] text-court-chart text-base">Wallet Control Verified</span>
        </div>
        <h1 className="font-display text-court-ice text-3xl sm:text-4xl break-words leading-tight">{displayName}</h1>
        <p className="font-mono text-sm text-court-mute mt-2 break-all">{data.address_short} · {data.network}</p>
        <p className="font-mono text-xs text-court-mute mt-1">Verified {fmtDate(data.verified_at)}</p>
      </div>

      {/* Social handles */}
      {data.handles && data.handles.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.handles.map((h) => (
            <div key={h.provider} className="inline-flex items-center gap-1.5 border-2 border-court-ice bg-court-navy px-3 py-1.5">
              <AtSign className="h-3.5 w-3.5 text-court-chart" />
              <span className="font-mono text-xs text-court-ice">{h.provider_label}</span>
              <span className="font-mono text-sm text-court-ice">{h.display_handle}</span>
              <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-court-mute border border-court-mute px-1 py-0.5">
                {h.verification_state === "verified" ? "Verified" : "Unverified"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Court Appearances" value={data.counts?.appearances ?? 0} />
        <Stat label="Highest Severity" value={data.counts?.highest_severity ?? 0} />
        <Stat label="Latest Appearance" value={data.counts?.latest_appearance_date ? fmtDate(data.counts.latest_appearance_date) : "—"} />
        <Stat label="Latest Verdict" value={data.latest_verdict?.name || "—"} />
      </div>

      {/* Official Defense (public view) */}
      {!isOwner && data.official_defense && (
        <div className="mt-6">
          <OfficialDefensePanel
            claimSlug={claimSlug}
            publicDefense={data.official_defense}
            isOwner={false}
          />
        </div>
      )}

      {/* Owner controls */}
      {isOwner && (
        <div className="mt-8">
          <RapSheetOwnerControls data={data} onReload={onReload} />
        </div>
      )}

      {/* Trial history */}
      {data.trials && data.trials.length > 0 ? (
        <div className="mt-8">
          <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-xl mb-3">Court Appearances</h2>
          <div className="space-y-3">
            {data.trials.map((t) => (
              <Link key={t.public_slug} to={`/case/${t.public_slug}`} className="block border-2 border-court-ice bg-court-navy p-4 hover:bg-court-uv transition-colors">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-display uppercase tracking-[0.04em] text-court-ice">{t.verdict_name}</span>
                  <span className="font-mono text-xs text-court-chart">Severity {t.severity_score}/100</span>
                </div>
                <p className="font-mono text-sm text-court-mute leading-relaxed">{t.headline}</p>
                <p className="font-mono text-xs text-court-mute mt-1">
                  {fmtDate(t.analyzed_at || t.created_date)} · {t.data_mode === "live" ? "Live · Nansen" : "Demo"}
                </p>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        !isOwner && data.profile_visibility !== "private" && (
          <p className="mt-8 font-mono text-sm text-court-mute">This owner has not made trial history public.</p>
        )
      )}

      {/* Badge cabinet */}
      <div className="mt-10">
        <BadgeCabinet show={data.show_badges} />
      </div>

      {/* Actions */}
      <div className="mt-10 grid grid-cols-2 gap-3">
        <button type="button" onClick={share} className="inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-3 border-2 border-court-ice hover:bg-court-uv transition-colors">
          {copied ? <Check className="h-4 w-4 text-court-chart" /> : <Share2 className="h-4 w-4" />} {copied ? "Copied" : "Share Rap Sheet"}
        </button>
        <Link to="/" className="inline-flex items-center justify-center gap-2 bg-court-red text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-3 border-2 border-court-ice hover:brightness-105 transition-all">
          <Gavel className="h-4 w-4" /> Roast This Wallet Again
        </Link>
      </div>
    </section>
  );
}