import { Link } from "react-router-dom";
import { FileText, ExternalLink } from "lucide-react";

const STATUS_BADGE = {
  pending: { label: "Pending", cls: "bg-court-mute text-court-navy" },
  approved: { label: "Approved", cls: "bg-court-chart text-court-navy" },
  rejected: { label: "Rejected", cls: "bg-court-red text-court-ice" },
  hidden: { label: "Hidden", cls: "bg-court-navy text-court-mute border-2 border-court-mute" }
};

export default function AccountDefenses({ defenses }) {
  if (!defenses || defenses.length === 0) {
    return (
      <section>
        <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">Official Defenses</h2>
        <div className="border-2 border-court-ice bg-court-navy p-6 text-center">
          <FileText className="h-8 w-8 text-court-mute mx-auto mb-3" />
          <p className="font-mono text-sm text-court-ice">
            No official defenses filed. Claim a wallet and submit a defense from its Rap Sheet.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">Official Defenses</h2>
      <div className="space-y-2">
        {defenses.map((d) => {
          const badge = STATUS_BADGE[d.moderation_status] || STATUS_BADGE.pending;
          return (
            <div key={`${d.claim_slug}-${d.version}`} className="border-2 border-court-ice bg-court-navy p-3">
              <div className="flex items-center gap-3 mb-2">
                <span className={`shrink-0 px-2 py-1 font-mono text-xs uppercase tracking-[0.1em] ${badge.cls}`}>
                  {badge.label}
                </span>
                <span className="font-mono text-xs text-court-mute">Version {d.version}</span>
                <span className="font-mono text-xs text-court-mute ml-auto">
                  {d.submitted_at ? new Date(d.submitted_at).toLocaleDateString() : ""}
                </span>
              </div>
              <p className="font-mono text-sm text-court-ice leading-relaxed">{d.text}</p>
              <Link
                to={`/wallet/${d.claim_slug}`}
                className="inline-flex items-center gap-1.5 mt-2 font-display uppercase tracking-[0.08em] text-xs text-court-chart hover:text-court-ice transition-colors"
              >
                View Rap Sheet <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}