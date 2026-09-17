import { cn } from "@/lib/utils";

export default function SeverityMeter({ severity, confidence }) {
  const sev = Math.max(0, Math.min(100, severity || 0));
  const tone =
    sev >= 80 ? { bar: "bg-court-red", text: "text-court-red", label: "Egregious" }
    : sev >= 50 ? { bar: "bg-court-ink", text: "text-court-ink", label: "Reckless" }
    : { bar: "bg-court-green", text: "text-court-ink", label: "Suspiciously clean" };

  return (
    <div className="border-2 border-court-ink bg-court-paper p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-court-gray">
          Severity Index
        </span>
        <span className={cn("font-mono font-bold text-lg", tone.text)}>
          {sev.toFixed(0)}<span className="text-xs text-court-gray">/100</span>
        </span>
      </div>
      <div className="h-3 w-full border border-court-ink bg-court-folder overflow-hidden">
        <div className={cn("h-full", tone.bar)} style={{ width: `${sev}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[0.6rem] uppercase tracking-[0.15em] text-court-gray">
        <span>{tone.label}</span>
        <span>Confidence {(confidence || 0).toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full border border-court-ink/60 bg-court-folder overflow-hidden">
        <div className="h-full bg-court-ink" style={{ width: `${confidence || 0}%` }} />
      </div>
    </div>
  );
}