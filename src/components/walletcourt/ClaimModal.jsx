import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
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
import { reownConfigured } from "@/lib/reown";
import { createClaimNonce, verifyClaim } from "@/lib/walletClaim";
import { trackClaim, CLAIM_EVENTS } from "@/lib/claimAnalytics";

const STEPS = ["signin", "connect", "sign", "claimed"];

function shortOf(addr) {
  return addr && addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr || "";
}

// Inner component calls Reown hooks, so it is only mounted when Reown is
// configured — keeping the unconfigured app from crashing on missing hooks.
function ClaimModalInner({ trial, open, onOpenChange, onClaimed }) {
  const { isAuthenticated } = useAuth();
  const { open: openAppKit } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider("eip155");

  const [step, setStep] = useState("connect");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState(null);

  const caseAddr = (trial.normalized_wallet_address || "").toLowerCase();
  const caseShort = shortOf(trial.normalized_wallet_address);

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

  // When a wallet connects, validate it matches the case and request a nonce.
  useEffect(() => {
    if (!open || !isAuthenticated || step !== "connect") return;
    if (isConnected && address && address.toLowerCase() === caseAddr) {
      trackClaim(CLAIM_EVENTS.WALLET_CONNECTED, { network: trial.network });
      requestNonce();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, open, step]);

  async function requestNonce() {
    setBusy(true);
    setError("");
    try {
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
      setError(e?.message || "Could not start claim.");
    } finally {
      setBusy(false);
    }
  }

  function connectWallet() {
    try {
      openAppKit();
    } catch {
      setError("Wallet connection is not available right now.");
    }
  }

  async function signAndVerify() {
    setBusy(true);
    setError("");
    try {
      if (!walletProvider || !address) throw new Error("Wallet not connected.");
      const provider = new BrowserProvider(walletProvider);
      const signer = new JsonRpcSigner(provider, address);
      let signature;
      try {
        signature = await signer.signMessage(message);
      } catch {
        // user cancelled — keep them on the sign step, case preserved
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
      setError(e?.message || "Claim failed.");
    } finally {
      setBusy(false);
    }
  }

  const wrongDefendant = isConnected && address && address.toLowerCase() !== caseAddr;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-court-navy text-court-ice border-2 border-court-ice max-w-lg max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4 border-b-2 border-court-ice">
          <DialogTitle className="font-display uppercase tracking-[0.06em] text-court-ice text-2xl">
            Claim This Wallet
          </DialogTitle>
          <DialogDescription className="font-mono text-sm text-court-mute">
            Prove this wallet is yours and start its permanent court record.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
          {/* Step pills */}
          <ol className="flex items-center gap-1 sm:gap-2 font-mono text-xs uppercase tracking-[0.12em]">
            {STEPS.map((s, i) => (
              <li key={s} className={cn("flex items-center gap-1 sm:gap-2", step === s ? "text-court-chart" : "text-court-mute")}>
                <span className={cn("h-5 w-5 inline-flex items-center justify-center border-2 text-[0.7rem]", step === s ? "border-court-chart bg-court-chart text-court-navy" : "border-court-mute")}>{i + 1}</span>
                <span className="hidden sm:inline">{s === "signin" ? "Sign In" : s === "connect" ? "Connect" : s === "sign" ? "Sign" : "Claimed"}</span>
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
                You need a Wallet Court account to claim a wallet and manage its Rap Sheet. Your wallet signature proves control of the address — it does not replace your account.
              </p>
              <button
                type="button"
                onClick={() => base44.auth.redirectToLogin(`/case/${trial.public_slug}?claim=1`)}
                className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all"
              >
                <KeyRound className="h-5 w-5 text-court-navy" /> Sign In to Claim
              </button>
            </div>
          )}

          {step === "connect" && (
            <div className="space-y-3">
              <p className="font-mono text-sm text-court-ice leading-relaxed">
                Connect the EVM wallet that matches this case:{" "}
                <span className="text-court-chart">{trial.network} · {caseShort}</span>
              </p>
              {wrongDefendant && (
                <div role="alert" className="border-2 border-court-red bg-court-navy p-3 space-y-1">
                  <p className="font-display uppercase tracking-[0.06em] text-court-red text-base">Wrong Defendant</p>
                  <p className="font-mono text-sm text-court-ice leading-relaxed">
                    You connected <span className="text-court-chart">{shortOf(address)}</span>, but this case belongs to <span className="text-court-chart">{caseShort}</span>. Switch wallets to continue.
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={connectWallet}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-60"
              >
                <WalletIcon className="h-5 w-5 text-court-navy" /> {isConnected ? "Switch Wallet" : "Connect the Accused"}
              </button>
              {busy && <p className="font-mono text-sm text-court-mute">Requesting claim session…</p>}
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
                {busy ? <><Loader2 className="h-5 w-5 animate-spin" /> Signing…</> : <><ShieldCheck className="h-5 w-5 text-court-navy" /> Sign Claim Message</>}
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

function SetupDisabledDialog({ trial, open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-court-navy text-court-ice border-2 border-court-ice max-w-lg p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4 border-b-2 border-court-ice">
          <DialogTitle className="font-display uppercase tracking-[0.06em] text-court-ice text-2xl">
            Claim This Wallet
          </DialogTitle>
        </DialogHeader>
        <div className="px-5 py-5">
          <div className="border-2 border-court-red bg-court-navy p-4 font-mono text-sm text-court-ice leading-relaxed">
            <p className="text-court-red font-display uppercase tracking-[0.06em] mb-1">Wallet connection not configured</p>
            <p>
              The administrator must set <code className="text-court-chart">VITE_REOWN_PROJECT_ID</code> in the app environment variables to enable wallet claiming. The rest of Wallet Court still works.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ClaimModal({ trial, open, onOpenChange, onClaimed }) {
  if (!reownConfigured) {
    return <SetupDisabledDialog trial={trial} open={open} onOpenChange={onOpenChange} />;
  }
  return (
    <ClaimModalInner trial={trial} open={open} onOpenChange={onOpenChange} onClaimed={onClaimed} />
  );
}