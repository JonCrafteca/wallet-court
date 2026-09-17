import { Award } from "lucide-react";

// Phase 3A: visual cabinet + empty state only. No fabricated honors. Badge
// award logic belongs to Phase 3B.
export default function BadgeCabinet({ show = true }) {
  if (!show) return null;
  return (
    <div className="border-2 border-court-ice bg-court-navy p-5 sm:p-6 text-center">
      <div className="flex items-center justify-center gap-2 mb-3">
        <Award className="h-5 w-5 text-court-chart" />
        <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-xl">Badge Cabinet</h2>
      </div>
      <p className="font-display uppercase tracking-[0.06em] text-court-ice text-lg mb-1">No Court Honors Yet</p>
      <p className="font-mono text-sm text-court-mute leading-relaxed max-w-md mx-auto">
        Return to court, survive the evidence, and give the bench something worth remembering.
      </p>
    </div>
  );
}