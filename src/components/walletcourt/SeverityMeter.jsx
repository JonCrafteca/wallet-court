import { cn } from "@/lib/utils";

export default function SeverityMeter({ severity, confidence }) {
  const sev = Math.max(0, Math.min(100, severity || 0));
  const conf = Math.max(0, Math.min(100, confidence || 0));
  const tone =
    sev >= 80 ? { bar: "bg-court-red", text: "text-court-red", label: "Egregious" }
    : sev >= 50 ? { bar: "bg-court-cobalt", text: "text-court-ice", label: "Reckless" }
    : { bar: "bg-court-chart", text: "text-court-chart", label: "Suspiciously clean" };

  return (
    <div className="border-2 border-court-ice bg-court-navy p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="font-mono text-xs uppercase tracking-[0.16em] text-court-mute">Severity Index</span>
        <span className={cn("font-display text-2xl leading-none", tone.text)}>
          {sev.toFixed(0)}<span className="font-mono text-sm text-court-mute">/100</span>
        </span>
      </div>
      <div className="h-3 w-full border-2 border-court-ice bg-court-uv overflow-hidden">
        <div className={cn("h-full", tone.bar)} style={{ width: `${sev}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-xs uppercase tracking-[0.14em] text-court-mute">
        <span>{tone.label}</span>
        <span>Confidence {conf.toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-2 w-full border-2 border-court-ice bg-court-uv overflow-hidden">
        <div className="h-full bg-court-chart" style={{ width: `${conf}%` }} />
      </div>
    </div>
  );
}