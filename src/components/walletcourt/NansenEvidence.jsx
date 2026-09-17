import { useState } from "react";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

function safeParse(s, fallback) {
  try {
    return JSON.parse(s) || fallback;
  } catch {
    return fallback;
  }
}

const EXHIBIT = ["A", "B", "C", "D", "E", "F"];

export default function NansenEvidence({ trial }) {
  const items = safeParse(trial.evidence_items_json, []);
  const metrics = safeParse(trial.metrics_json, {});
  const sources = safeParse(trial.source_endpoints_json, []);
  const [open, setOpen] = useState(false);
  const isLive = trial.data_mode === "live";
  const metricEntries = Object.entries(metrics);

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="h-5 w-5 text-court-chart" />
        <h3 className="font-display uppercase tracking-[0.08em] text-court-ice text-xl sm:text-2xl">
          Nansen Evidence
        </h3>
        <span
          className={cn(
            "ml-auto font-mono text-xs uppercase tracking-[0.14em] px-2 py-1 border-2 bg-court-navy",
            isLive ? "border-court-chart text-court-chart" : "border-court-red text-court-red"
          )}
        >
          {isLive ? "Live · Nansen" : "Demo Mode"}
        </span>
      </div>

      <p className="font-mono text-base text-court-mute leading-relaxed mb-5 max-w-2xl">
        The court examined the wallet's onchain behavior through Nansen. Here is the evidence, in plain language.
      </p>

      <div className="grid sm:grid-cols-3 gap-4">
        {items.map((it, i) => (
          <div key={i} className="border-2 border-court-ice bg-court-navy p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="font-display uppercase tracking-[0.08em] text-court-chart text-sm">
                Exhibit {EXHIBIT[i % EXHIBIT.length]}
              </span>
              <span className="font-mono text-xs uppercase tracking-[0.1em] text-court-mute">{it.tag}</span>
            </div>
            <p className="font-mono text-xs uppercase tracking-[0.1em] text-court-mute mb-1">{it.label}</p>
            <p className="font-display text-2xl text-court-ice leading-none mb-2">{it.value}</p>
            <p className="font-mono text-base text-court-ice leading-relaxed">{it.detail}</p>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-5 inline-flex items-center gap-2 font-mono text-sm uppercase tracking-[0.12em] text-court-chart hover:text-court-ice transition-colors"
      >
        <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        {open ? "Hide Full Evidence" : "View Full Evidence"}
      </button>

      {open && (
        <div className="mt-4 border-2 border-court-mute bg-court-navy p-4 space-y-4">
          {metricEntries.length > 0 && (
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">Technical Metrics</p>
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
                {metricEntries.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 font-mono text-sm">
                    <dt className="text-court-mute">{k.replace(/_/g, " ")}</dt>
                    <dd className="text-court-ice text-right">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {sources.length > 0 && (
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">Sources Consulted</p>
              <ul className="font-mono text-sm text-court-ice space-y-1">
                {sources.map((s, i) => (
                  <li key={i} className="truncate">{s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}