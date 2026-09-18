import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Wallet as WalletIcon, Lock, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { base44 } from "@/api/base44Client";
import { getClaimStatus } from "@/lib/walletClaim";
import { reownConfigured } from "@/lib/reown";
import ClaimModal from "./ClaimModal";
import OfficialDefensePanel from "./OfficialDefensePanel";

export default function ClaimWalletSection({ trial }) {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const eligible = trial.network === "ethereum" || trial.network === "base";

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await getClaimStatus(trial.public_slug);
      if (alive) setStatus(s);
    })();
    return () => { alive = false; };
  }, [trial.public_slug, refreshKey]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("claim") === "1" && isAuthenticated && eligible) {
      setModalOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("claim");
      window.history.replaceState({}, "", url.toString());
    }
  }, [isAuthenticated, eligible, trial.public_slug]);

  function handleClaimClick() {
    if (!eligible) return;
    if (!isAuthenticated) {
      base44.auth.redirectToLogin(`/case/${trial.public_slug}?claim=1`);
      return;
    }
    setModalOpen(true);
  }

  // Solana — honest "coming next", never faked.
  if (!eligible) {
    return (
      <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5">
        <p className="font-display uppercase tracking-[0.06em] text-court-chart text-lg mb-1">
          Solana Wallet Claiming — Coming Next
        </p>
        <p className="font-mono text-sm text-court-ice leading-relaxed">
          This Solana case is fully analyzable, shareable, and challengeable. Verified wallet claiming for Solana arrives in a later phase.
        </p>
      </div>
    );
  }

  // Claimed by the current user.
  if (status?.claimed && status?.is_owner) {
    return (
      <div>
        <div className="border-2 border-court-chart bg-court-uv p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="h-5 w-5 text-court-chart" />
            <span className="font-display uppercase tracking-[0.06em] text-court-chart text-lg">Wallet Control Verified</span>
          </div>
          {status.court_name && (
            <p className="font-display text-court-ice text-xl mb-1">{status.court_name}</p>
          )}
          <p className="font-mono text-sm text-court-ice leading-relaxed mb-3">
            You own this wallet's permanent court record.
          </p>
          <Link
            to={`/wallet/${status.claim_slug}`}
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy hover:brightness-105 transition-all"
          >
            Manage Rap Sheet <ExternalLink className="h-4 w-4" />
          </Link>
        </div>
        {status.official_defense && (
          <div className="mt-4">
            <OfficialDefensePanel publicDefense={status.official_defense} isOwner={false} />
          </div>
        )}
      </div>
    );
  }

  // Claimed by someone else.
  if (status?.claimed && !status?.is_owner) {
    return (
      <div>
        <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5 flex items-center gap-3">
          <Lock className="h-5 w-5 text-court-mute shrink-0" />
          <div className="min-w-0">
            <p className="font-display uppercase tracking-[0.06em] text-court-ice text-lg">Claimed Wallet</p>
            {status.court_name && (
              <p className="font-display text-court-ice text-base">{status.court_name}</p>
            )}
            <p className="font-mono text-sm text-court-mute leading-relaxed">
              {status.linkable ? "This wallet's owner has a public Rap Sheet." : "The owner of this wallet has claimed it."}
            </p>
          </div>
          {status.linkable && status.claim_slug && (
            <Link
              to={`/wallet/${status.claim_slug}`}
              className="ml-auto inline-flex items-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-2 border-2 border-court-ice hover:bg-court-uv transition-colors"
            >
              Rap Sheet <ExternalLink className="h-4 w-4" />
            </Link>
          )}
        </div>
        {status.official_defense && (
          <div className="mt-4">
            <OfficialDefensePanel publicDefense={status.official_defense} isOwner={false} />
          </div>
        )}
      </div>
    );
  }

  // Unclaimed EVM.
  const setupDisabled = !reownConfigured;
  return (
    <>
      <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <WalletIcon className="h-6 w-6 text-court-chart shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-display uppercase tracking-[0.06em] text-court-ice text-lg mb-1">Claim This Wallet</p>
            <p className="font-mono text-sm text-court-mute leading-relaxed mb-3">
              Prove this wallet is yours and start its permanent court record.
            </p>
            {setupDisabled ? (
              <p className="font-mono text-sm text-court-red leading-relaxed">
                Wallet claiming is not configured. The administrator must set{" "}
                <code className="text-court-chart">VITE_REOWN_PROJECT_ID</code> to enable it.
              </p>
            ) : (
              <button
                type="button"
                onClick={handleClaimClick}
                className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
              >
                <ShieldCheck className="h-4 w-4" /> {isAuthenticated ? "Claim This Wallet" : "Sign In to Claim"}
              </button>
            )}
          </div>
        </div>
      </div>
      {!setupDisabled && (
        <ClaimModal
          trial={trial}
          open={modalOpen}
          onOpenChange={setModalOpen}
          onClaimed={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </>
  );
}