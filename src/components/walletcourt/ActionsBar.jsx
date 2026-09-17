import { useState } from "react";
import { Copy, Check, Gavel } from "lucide-react";

export default function ActionsBar({ slug, onReset }) {
  const [copied, setCopied] = useState(false);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/case/${slug}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center justify-center gap-2 border-2 border-court-navy bg-court-chart text-court-navy px-4 py-3 font-display uppercase tracking-[0.1em] text-base hover:brightness-105 transition-all shadow-[4px_4px_0_0_#FF3B30]"
      >
        {copied ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
        {copied ? "Copied" : "Copy Case Link"}
      </button>
      <button
        type="button"
        onClick={onReset}
        className="inline-flex items-center justify-center gap-2 border-2 border-court-ice bg-court-red text-court-ice px-4 py-3 font-display uppercase tracking-[0.1em] text-base hover:brightness-105 transition-all shadow-[4px_4px_0_0_#10142A]"
      >
        <Gavel className="h-5 w-5" />
        Roast Another Wallet
      </button>
    </div>
  );
}