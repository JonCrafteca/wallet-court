import { useState } from "react";
import { Copy, Check, RotateCcw } from "lucide-react";

export default function ShareBar({ slug, onReset }) {
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
    <div className="border border-court-line bg-court-surface p-3 space-y-3">
      <div>
        <p className="text-[0.6rem] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
          Permanent Case URL
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate font-mono text-xs text-court-text border border-court-line bg-court-bg px-2 py-2">
            {url}
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 border border-court-gold text-court-gold px-3 py-2 text-[0.65rem] uppercase tracking-[0.15em] hover:bg-court-gold/10 transition"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onReset}
        className="w-full inline-flex items-center justify-center gap-2 border border-court-line text-court-text px-3 py-2.5 text-[0.7rem] uppercase tracking-[0.18em] hover:border-court-gold hover:text-court-gold transition"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Try Another Wallet
      </button>
    </div>
  );
}