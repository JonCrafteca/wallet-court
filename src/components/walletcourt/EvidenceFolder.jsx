import { useState } from "react";
import { ChevronDown, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

function safeParse(s, fallback) {
  try {
    return JSON.parse(s) || fallback;
  } catch {
    return fallback;
  }
}

const EXHIBIT = ["A", "B", "C", "D", "E", "F"];

export default function EvidenceFolder({ trial }) {
  const items = safeParse(trial.evidence_items_json, []);
  const sources = safeParse(trial.source_endpoints_json, []);
  const [open, setOpen] = useState(() => items.map(() => true));

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <FolderOpen className="h-4 w-4 text-court-chart" />
        <h3 className="font-display uppercase tracking-[0.1em] text-court-ice text-base">
          Onchain Evidence Folder
        </h3>
        <span className="ml-auto font-mono text-[0.58rem] uppercase tracking-[0.15em] text-court-mute">
          {items.length} exhibits
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {items.map((it, i) => (
          <div
            key={i}
            className={cn(
              "border-2 border-court-ice bg-court-navy p-3 shadow-[4px_4px_0_0_#5127C7]",
              i % 2 ? "rotate-[0.4deg]" : "-rotate-[0.4deg]"
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-display uppercase tracking-[0.08em] text-court-chart text-base">
                Exhibit {EXHIBIT[i % EXHIBIT.length]}
              </span>
              <span className="font-mono text-[0.52rem] uppercase tracking-[0.12em] text-court-mute border border-court-mute px-1">
                {it.tag}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen((o) => o.map((v, j) => (j === i ? !v : v)))}
              className="w-full flex items-center gap-2 text-left"
            >
              <span className="font-mono text-[0.62rem] uppercase tracking-[0.12em] text-court-mute">
                {it.label}
              </span>
              <ChevronDown className={cn("h-3.5 w-3.5 ml-auto text-court-ice transition-transform", open[i] && "rotate-180")} />
            </button>
            <div className="mt-1.5 font-display text-2xl text-court-ice leading-none">{it.value}</div>
            {open[i] && <p className="mt-1.5 font-mono text-xs text-court-mute leading-relaxed">{it.detail}</p>}
          </div>
        ))}
      </div>

      {sources.length > 0 && (
        <div className="mt-3 border-t border-court-mute/40 pt-2">
          <p className="font-mono text-[0.55rem] uppercase tracking-[0.18em] text-court-mute mb-1">
            Sources consulted
          </p>
          <ul className="font-mono text-[0.62rem] text-court-ice space-y-0.5">
            {sources.map((s, i) => (
              <li key={i} className="truncate">{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}