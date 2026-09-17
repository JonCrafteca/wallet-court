import { cn } from "@/lib/utils";

export default function SeverityMeter({ severity, confidence }) {
  const sev = Math.max(0, Math.min(100, severity || 0));
  const tone =
    sev >= 80 ? { bar: "bg-court-red", text: "text-court-red", label: "Egregious" }
    : sev >= 50 ? { bar: "bg-court-chart", text: "text-court-chart", label: "Reckless" }
    : { bar: "bg-court-cobalt", text: "text-court-cobalt", label: "Suspiciously clean" };

  return (
    <div className="border-2 border-court-ice bg-court-navy p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-court-mute">
          Severity Index
        </span>
        <span className={cn("font-display text-2xl leading-none", tone.text)}>
          {sev.toFixed(0)}<span className="font-mono text-xs text-court-mute">/100</span>
        </span>
      </div>
      <div className="h-4 w-full border-2 border-court-ice bg-court-uv overflow-hidden">
        <div className={cn("h-full", tone.bar)} style={{ width: `${sev}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[0.6rem] uppercase tracking-[0.15em] text-court-mute">
        <span>{tone.label}</span>
        <span>Confidence {(confidence || 0).toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-2 w-full border-2 border-court-ice bg-court-uv overflow-hidden">
        <div className="h-full bg-court-chart" style={{ width: `${confidence || 0}%` }} />
      </div>
    </div>
  );
}