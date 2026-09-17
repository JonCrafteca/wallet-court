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
    <div className="border-2 border-court-ink bg-court-paper p-3 space-y-3">
      <div>
        <p className="font-mono text-[0.58rem] uppercase tracking-[0.18em] text-court-gray mb-1.5">
          Permanent Case URL
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate font-mono text-xs text-court-ink border-2 border-court-ink bg-court-bg px-2 py-2">
            {url}
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 border-2 border-court-ink bg-court-ink text-court-bg px-3 py-2 text-[0.6rem] uppercase tracking-[0.15em] hover:bg-court-red hover:border-court-red transition-colors"
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
          className="inline-flex items-center justify-center gap-2 border-2 border-court-ink bg-court-folder text-court-ink px-3 py-2.5 text-[0.66rem] uppercase tracking-[0.16em] hover:bg-court-ink hover:text-court-bg transition-colors"
        >
          <Copy className="h-3.5 w-3.5" />
          Share Case
        </button>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 border-2 border-court-ink bg-court-ink text-court-bg px-3 py-2.5 text-[0.66rem] uppercase tracking-[0.16em] hover:bg-court-red hover:border-court-red transition-colors"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          New Trial
        </button>
      </div>
    </div>
  );
}