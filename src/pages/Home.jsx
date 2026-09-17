import { useState } from "react";
import { base44 } from "@/api/base44Client";
import IntakeStage from "@/components/walletcourt/IntakeStage";
import LoadingStage from "@/components/walletcourt/LoadingStage";
import VerdictReveal from "@/components/walletcourt/VerdictReveal";

const NETWORKS = [
  { id: "ethereum", label: "Ethereum" },
  { id: "base", label: "Base" },
  { id: "solana", label: "Solana" },
];

export default function Home() {
  const [network, setNetwork] = useState("ethereum");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | done
  const [trial, setTrial] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!address.trim()) {
      setError("A wallet address is required for the summons.");
      return;
    }
    setStatus("loading");
    try {
      const [res] = await Promise.all([
        base44.functions.invoke("analyzeWalletWithNansen", {
          wallet_address: address.trim(),
          network,
        }),
        new Promise((r) => setTimeout(r, 2800)),
      ]);
      if (res?.data?.error) {
        setError(res.data.error);
        setStatus("idle");
        return;
      }
      setTrial(res.data.trial);
      setStatus("done");
    } catch (err) {
      setError(err?.message || "The court failed to convene. Try again.");
      setStatus("idle");
    }
  }

  function handleReset() {
    setStatus("idle");
    setTrial(null);
    setAddress("");
    setError("");
  }

  if (status === "done" && trial) {
    return <VerdictReveal trial={trial} onReset={handleReset} />;
  }

  return (
    <div className="relative">
      <IntakeStage
        network={network}
        setNetwork={setNetwork}
        networks={NETWORKS}
        address={address}
        setAddress={setAddress}
        onSubmit={handleSubmit}
        error={error}
      />
      <LoadingStage visible={status === "loading"} />
    </div>
  );
}