import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getAccountDashboard } from "@/lib/accountDashboard";
import AccountOverview from "@/components/walletcourt/AccountOverview";
import AccountTrials from "@/components/walletcourt/AccountTrials";
import AccountWallets from "@/components/walletcourt/AccountWallets";
import AccountDefenses from "@/components/walletcourt/AccountDefenses";
import { Loader2, AlertTriangle, LogOut, Scale, RotateCw } from "lucide-react";

export default function Account() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const d = await getAccountDashboard();
        if (!alive) return;
        if (d?.error) {
          setError(d.error);
          setLoading(false);
          return;
        }
        setData(d);
      } catch (e) {
        if (alive) setError(e?.message || "Could not load your account.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-court-chart" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <AlertTriangle className="h-10 w-10 text-court-red mx-auto mb-4" />
        <p className="font-display uppercase tracking-[0.06em] text-court-red text-xl mb-2">Account Data Unavailable</p>
        <p className="font-mono text-sm text-court-ice mb-6">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy hover:brightness-105 transition-all"
        >
          <RotateCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-12 space-y-10">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-4 border-court-chart pb-4">
        <div>
          <h1 className="font-display uppercase tracking-[0.04em] text-court-ice text-3xl sm:text-4xl flex items-center gap-2">
            <Scale className="h-7 w-7 text-court-chart" /> My Court
          </h1>
          <p className="font-mono text-sm text-court-mute mt-1">{data.user?.email || user?.email || "Signed in"}</p>
        </div>
        <button
          type="button"
          onClick={() => logout()}
          className="inline-flex items-center gap-2 border-2 border-court-ice text-court-ice px-3 py-2 font-display uppercase tracking-[0.08em] text-sm hover:bg-court-red hover:border-court-red transition-colors"
        >
          <LogOut className="h-4 w-4" /> Sign Out
        </button>
      </div>

      <AccountOverview counts={data.counts} />
      <AccountTrials trials={data.trials} />
      <AccountWallets wallets={data.wallets} />
      <AccountDefenses defenses={data.defenses} />
    </div>
  );
}