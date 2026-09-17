import { cn } from "@/lib/utils";

function verdictColor(verdictCode, severity) {
  if (verdictCode === "suspiciously_competent") return "court-green";
  if (severity >= 80) return "court-red";
  return "court-gold";
}

export default function VerdictStamp({ trial }) {
  const color = verdictColor(trial.verdict_code, trial.severity_score);
  const colorClass = {
    "court-green": "text-court-green",
    "court-red": "text-court-red",
    "court-gold": "text-court-gold",
  }[color];

  return (
    <div className="relative">
      <div className="flex items-center justify-between text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground mb-3">
        <span>Verdict · The Court Finds</span>
        <span>File {trial.public_slug?.slice(-6).toUpperCase()}</span>
      </div>
      <div
        className={cn(
          "stamp-emboss border-2 border-current bg-court-surface px-5 py-6 -rotate-1",
          colorClass
        )}
      >
        <p className="text-[0.6rem] uppercase tracking-[0.25em] opacity-80 mb-1">Ruling</p>
        <h2
          className="font-display font-black uppercase leading-[0.92]"
          style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)" }}
        >
          {trial.verdict_name}
        </h2>
        <div className="mt-3 flex items-center justify-between text-[0.6rem] uppercase tracking-[0.2em] opacity-80">
          <span>Wallet Court</span>
          <span>Sealed {new Date(trial.analyzed_at || Date.now()).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}