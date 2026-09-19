import { Link } from "react-router-dom";
import { ShieldCheck, ExternalLink, Lock, Eye, EyeOff } from "lucide-react";

const VIS_LABEL = {
  private: { label: "Private", icon: Lock },
  unlisted: { label: "Unlisted", icon: EyeOff },
  public: { label: "Public", icon: Eye }
};

export default function AccountWallets({ wallets }) {
  if (!wallets || wallets.length === 0) {
    return (
      <section>
        <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">My Verified Wallets</h2>
        <div className="border-2 border-court-ice bg-court-navy p-6 text-center">
          <ShieldCheck className="h-8 w-8 text-court-mute mx-auto mb-3" />
          <p className="font-mono text-sm text-court-ice">
            No verified wallets yet. Claim a wallet from any live case to start its Rap Sheet.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">My Verified Wallets</h2>
      <div className="space-y-2">
        {wallets.map((w) => {
          const vis = VIS_LABEL[w.profile_visibility] || VIS_LABEL.private;
          const VisIcon = vis.icon;
          return (
            <div key={w.claim_slug} className="border-2 border-court-ice bg-court-navy p-3">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-court-chart shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-display text-base text-court-ice">{w.court_name || "Unnamed Wallet"}</p>
                  <p className="font-mono text-xs text-court-mute">{w.network} · {w.address_short}</p>
                </div>
                <span className="shrink-0 inline-flex items-center gap-1 font-mono text-xs text-court-mute">
                  <VisIcon className="h-3.5 w-3.5" /> {vis.label}
                </span>
              </div>
              <Link
                to={`/wallet/${w.claim_slug}`}
                className="inline-flex items-center gap-1.5 mt-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-xs px-3 py-1.5 border-2 border-court-navy hover:brightness-105 transition-all"
              >
                Manage Identity <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
          );
        })}
      </div>
    </section>
  );
}