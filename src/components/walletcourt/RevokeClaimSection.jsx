import { useState, useEffect } from "react";
import { useAppKit, useAppKitAccount, useAppKitProvider } from "@reown/appkit/react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { Loader2, ShieldX, AlertTriangle } from "lucide-react";
import { reownConfigured } from "@/lib/reown";
import { createRevokeNonce, revokeClaim } from "@/lib/walletClaim";

function RevokeClaimInner({ claimSlug, onRevoked }) {
  const { open: openAppKit } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider("eip155");
  const [step, setStep] = useState("init"); // init | sign | done
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);

  async function startRevoke() {
    setConfirm(false);
    setBusy(true);
    setError("");
    try {
      if (!isConnected) {
        openAppKit();
        return;
      }
      const data = await createRevokeNonce(claimSlug);
      if (data?.error) { setError(data.error); return; }
      setMessage(data.message);
      setStep("sign");
    } catch (e) {
      setError(e?.message || "Could not start revocation.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (isConnected && step === "init" && confirm) startRevoke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  async function signAndRevoke() {
    setBusy(true);
    setError("");
    try {
      if (!walletProvider || !address) throw new Error("Wallet not connected.");
      const provider = new BrowserProvider(walletProvider);
      const signer = new JsonRpcSigner(provider, address);
      let signature;
      try { signature = await signer.signMessage(message); }
      catch { setError("Signing was cancelled."); setBusy(false); return; }
      const data = await revokeClaim(claimSlug, message, signature);
      if (data?.error) { setError(data.error); setBusy(false); return; }
      setStep("done");
      if (onRevoked) onRevoked();
    } catch (e) {
      setError(e?.message || "Revocation failed.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "done") {
    return (
      <div className="border-2 border-court-red bg-court-navy p-4 text-center">
        <ShieldX className="h-8 w-8 text-court-red mx-auto mb-2" />
        <p className="font-display uppercase tracking-[0.06em] text-court-red text-lg">Claim Revoked</p>
        <p className="font-mono text-sm text-court-ice mt-1">This wallet is no longer claimed.</p>
      </div>
    );
  }

  return (
    <div className="border-2 border-court-red/60 bg-court-navy p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-4 w-4 text-court-red" />
        <span className="font-display uppercase tracking-[0.06em] text-court-red text-sm">Revoke Wallet Claim</span>
      </div>
      <p className="font-mono text-xs text-court-mute mb-3 leading-relaxed">
        This permanently revokes your claim. A fresh wallet signature is required. The wallet's Rap Sheet will be removed.
      </p>
      {error && <p className="font-mono text-sm text-court-red mb-2" role="alert">{error}</p>}
      {step === "sign" && message && (
        <div className="mb-3">
          <div className="border-2 border-court-ice bg-court-navy p-2 font-mono text-xs text-court-mute max-h-32 overflow-y-auto whitespace-pre-wrap mb-2">{message}</div>
          <button onClick={signAndRevoke} disabled={busy} className="w-full inline-flex items-center justify-center gap-2 bg-court-red text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-2.5 border-2 border-court-ice disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldX className="h-4 w-4" />} Sign to Revoke
          </button>
        </div>
      )}
      {step === "init" && !confirm && (
        <button onClick={() => setConfirm(true)} className="font-mono text-sm uppercase tracking-[0.1em] text-court-red hover:text-court-ice">
          Revoke this claim…
        </button>
      )}
      {step === "init" && confirm && (
        <div className="border-2 border-court-red p-3">
          <p className="font-mono text-sm text-court-ice mb-2">Are you sure? This cannot be undone.</p>
          <div className="flex gap-2">
            <button onClick={startRevoke} disabled={busy} className="bg-court-red text-court-ice font-display uppercase tracking-[0.06em] text-sm px-3 py-2 border-2 border-court-ice disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Yes, revoke"}
            </button>
            <button onClick={() => setConfirm(false)} className="font-mono text-sm text-court-mute hover:text-court-ice">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RevokeClaimSection({ claimSlug, onRevoked }) {
  if (!reownConfigured) return null;
  return <RevokeClaimInner claimSlug={claimSlug} onRevoked={onRevoked} />;
}