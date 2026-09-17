import { cn } from "@/lib/utils";

export default function SeverityMeter({ severity, confidence }) {
  const sev = Math.max(0, Math.min(100, severity || 0));
  const tone = sev >= 80 ? "court-red" : sev >= 50 ? "court-gold" : "court-green";

  return (
    <div className="border border-court-line bg-court-surface p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
          Severity Index
        </span>
        <span className={cn("font-mono font-semibold text-lg", tone === "court-red" ? "text-court-red" : tone === "court-gold" ? "text-court-gold" : "text-court-green")}>
          {sev.toFixed(0)}<span className="text-xs text-muted-foreground">/100</span>
        </span>
      </div>
      <div className="h-2 w-full bg-court-bg border border-court-line overflow-hidden">
        <div
          className={cn("h-full", tone === "court-red" ? "bg-court-red" : tone === "court-gold" ? "bg-court-gold" : "bg-court-green")}
          style={{ width: `${sev}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-[0.65rem] uppercase tracking-[0.15em] text-muted-foreground">
        <span>Confidence</span>
        <span className="font-mono text-court-text">{(confidence || 0).toFixed(0)}%</span>
      </div>
    </div>
  );
}