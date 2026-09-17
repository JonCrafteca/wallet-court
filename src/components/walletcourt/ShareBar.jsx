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
    <div className="border-2 border-court-ice bg-court-navy p-3 space-y-3">
      <div>
        <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-court-mute mb-1.5">
          Permanent Case URL
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate font-mono text-xs text-court-ice border-2 border-court-ice bg-court-cobalt px-2 py-2">
            {url}
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 border-2 border-court-ice bg-court-uv text-court-ice px-3 py-2 font-mono text-[0.6rem] uppercase tracking-[0.15em] hover:bg-court-cobalt transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center justify-center gap-2 border-2 border-court-navy bg-court-chart text-court-navy px-3 py-2.5 font-display uppercase tracking-[0.1em] text-sm hover:brightness-105 transition-all shadow-[3px_3px_0_0_#10142A]"
        >
          <Copy className="h-4 w-4" />
          Share Case
        </button>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 border-2 border-court-ice bg-court-red text-court-ice px-3 py-2.5 font-display uppercase tracking-[0.1em] text-sm hover:brightness-105 transition-all shadow-[3px_3px_0_0_#10142A]"
        >
          <RotateCcw className="h-4 w-4" />
          New Trial
        </button>
      </div>
    </div>
  );
}