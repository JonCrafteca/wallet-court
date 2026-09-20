import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";
import {
  ShieldCheck,
  Wallet as WalletIcon,
  ArrowRight,
  Loader2,
  Check,
  KeyRound
} from "lucide-react";
import { cn } from "@/lib/utils";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { createClaimNonce, verifyClaim } from "@/lib/walletClaim";
import { trackClaim, CLAIM_EVENTS } from "@/lib/claimAnalytics";
import { connectSolana, signSolanaMessage, isSolanaWalletAvailable } from "@/lib/solanaWallet";

const STEPS = ["signin", "connect", "sign", "claimed"];

function shortOf(addr) {
  return addr && addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr || "";
}

// Solana ownership verification modal. Uses direct browser wallet injection
// (window.solana — Phantom, Solflare, etc.) instead of Reown AppKit, which is
// EVM-only. The backend verifies the Ed25519 signature with crypto.subtle.
export default function SolanaClaimModal({ trial, open, onOpenChange, onClaimed }) {
  const { isAuthenticated } = useAuth();
  const [step, setStep] = useState("connect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);

  const caseShort = trial.address_short || shortOf(trial.normalized_wallet_address || trial.wallet_address);
  const walletAvailable = isSolanaWalletAvailable();

  useEffect(() => {
    if (open) {
      setError("");
      setResult(null);
      setMessage("");
      setBusy(false);
      setStep(isAuthenticated ? "connect" : "signin");
      trackClaim(CLAIM_EVENTS.CLAIM_STARTED, { network: trial.network });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function connectAndRequestNonce() {
    setBusy(true);
    setError("");
    try {
      const address = await connectSolana();
      const normalized = trial.normalized_wallet_address || trial.wallet_address;
      if (address !== normalized) {
        setError(`Wrong wallet. This case belongs to ${caseShort}. Switch wallets to continue.`);
        setBusy(false);
        return;
      }
      trackClaim(CLAIM_EVENTS.WALLET_CONNECTED, { network: trial.network });
      const data = await createClaimNonce(trial.public_slug);
      if (data?.error) {
        setError(data.error);
        setBusy(false);
        return;
      }
      setMessage(data.message);
      setStep("sign");
      trackClaim(CLAIM_EVENTS.SIGNATURE_REQUESTED, { network: trial.network });
    } catch (e) {
      if (e?.code === 4001 || e?.message?.includes("reject")) {
        setError("Connection was cancelled. Your case is still here — try again when ready.");
      } else {
        setError(e?.message || "Could not connect to Solana wallet.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function signAndVerify() {
    setBusy(true);
    setError("");
    try {
      let signature;
      try {
        signature = await signSolanaMessage(message);
      } catch {
        setError("Signing was cancelled. Your case is still here — try again when ready.");
        setBusy(false);
        return;
      }
      const data = await verifyClaim(trial.public_slug, message, signature);
      if (data?.error) {
        trackClaim(CLAIM_EVENTS.CLAIM_FAILED, { network: trial.network });
        setError(data.error);
        setBusy(false);
        return;
      }
      trackClaim(CLAIM_EVENTS.CLAIM_VERIFIED, { network: trial.network });
      setResult(data);
      setStep("claimed");
      if (onClaimed) onClaimed();
    } catch (e) {
      trackClaim(CLAIM_EVENTS.CLAIM_FAILED, { network: trial.network });
      setError(e?.message || "Verification failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-court-navy text-court-ice border-2 border-court-ice max-w-lg max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4 border-b-2 border-court-ice">
          <DialogTitle className="font-display uppercase tracking-[0.06em] text-court-ice text-2xl">
            Verify Ownership
          </DialogTitle>
          <DialogDescription className="font-mono text-sm text-court-mute">
            Sign a free message to prove this Solana wallet is yours.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          <ol className="flex items-center gap-1 sm:gap-2 font-mono text-xs uppercase tracking-[0.12em]">
            {STEPS.map((s, i) => (
              <li key={s} className={cn("flex items-center gap-1 sm:gap-2", step === s ? "text-court-chart" : "text-court-mute")}>
                <span className={cn("h-5 w-5 inline-flex items-center justify-center border-2 text-[0.7rem]", step === s ? "border-court-chart bg-court-chart text-court-navy" : "border-court-mute")}>{i + 1}</span>
                <span className="hidden sm:inline">{s === "signin" ? "Sign In" : s === "connect" ? "Connect" : s === "sign" ? "Sign" : "Verified"}</span>
                {i < 3 && <span className="text-court-mute">›</span>}
              </li>
            ))}
          </ol>

          {error && (
            <div role="alert" className="border-2 border-court-red bg-court-navy p-3 font-mono text-sm text-court-red leading-relaxed">
              {error}
            </div>
          )}

          {step === "signin" && (
            <div className="space-y-3">
              <p className="font-mono text-sm text-court-ice leading-relaxed">
                You need a Wallet Court account to verify wallet ownership and manage its Rap Sheet. Your wallet signature proves control of the address — it does not replace your account.
              </p>
              <button
                type="button"
                onClick={() => base44.auth.redirectToLogin(`/case/${trial.public_slug}?claim=1`)}
                className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all"
              >
                <KeyRound className="h-5 w-5 text-court-navy" /> Sign In to Verify
              </button>
            </div>
          )}

          {step === "connect" && (
            <div className="space-y-3">
              <p className="font-mono text-sm text-court-ice leading-relaxed">
                Connect the Solana wallet that matches this case:{" "}
                <span className="text-court-chart">{trial.network} · {caseShort}</span>
              </p>
              {!walletAvailable && (
                <div role="alert" className="border-2 border-court-red bg-court-navy p-3 space-y-1">
                  <p className="font-display uppercase tracking-[0.06em] text-court-red text-base">No Solana Wallet Found</p>
                  <p className="font-mono text-sm text-court-ice leading-relaxed">
                    Install Phantom or another Solana wallet extension, then refresh this page.
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={connectAndRequestNonce}
                disabled={busy || !walletAvailable}
                className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-60"
              >
                <WalletIcon className="h-5 w-5 text-court-navy" /> Connect Solana Wallet
              </button>
              {busy && <p className="font-mono text-sm text-court-mute">Requesting verification session…</p>}
            </div>
          )}

          {step === "sign" && (
            <div className="space-y-3">
              <ul className="font-mono text-sm text-court-ice leading-relaxed space-y-1">
                <li className="flex gap-2"><Check className="h-4 w-4 text-court-chart shrink-0 mt-0.5" /> Free — no gas, no transaction.</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-court-chart shrink-0 mt-0.5" /> No token approval, no access to funds.</li>
                <li className="flex gap-2"><Check className="h-4 w-4 text-court-chart shrink-0 mt-0.5" /> Proves control of this wallet only.</li>
              </ul>
              <div className="border-2 border-court-ice bg-court-navy p-3 font-mono text-xs text-court-mute leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                {message}
              </div>
              <button
                type="button"
                onClick={signAndVerify}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-60"
              >
                {busy ? <><Loader2 className="h-5 w-5 animate-spin" /> Signing…</> : <><ShieldCheck className="h-5 w-5 text-court-navy" /> Sign to Verify</>}
              </button>
            </div>
          )}

          {step === "claimed" && result && (
            <div className="space-y-4">
              <div className="border-2 border-court-chart bg-court-uv p-4 text-center">
                <ShieldCheck className="h-10 w-10 text-court-chart mx-auto mb-2" />
                <p className="font-display uppercase tracking-[0.06em] text-court-chart text-lg">Wallet Control Verified</p>
                <p className="font-mono text-sm text-court-ice mt-1">{result.claim?.address_short || caseShort} · {trial.network}</p>
                <p className="font-mono text-xs text-court-mute mt-1">
                  Verified {new Date(result.claim?.verified_at || Date.now()).toLocaleDateString()}
                </p>
              </div>
              <p className="font-mono text-xs text-court-mute leading-relaxed text-center">
                This proves control of the wallet only. It is not identity verification and does not endorse any verdict.
              </p>
              <Link
                to={`/wallet/${result.claim?.claim_slug}`}
                className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all"
              >
                Set Up My Rap Sheet <ArrowRight className="h-5 w-5 text-court-navy" />
              </Link>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}