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

export default function EvidenceFolder({ trial }) {
  const items = safeParse(trial.evidence_items_json, []);
  const sources = safeParse(trial.source_endpoints_json, []);
  const [open, setOpen] = useState(() => items.map(() => true));

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <FolderOpen className="h-4 w-4 text-court-gold" />
        <h3 className="text-[0.7rem] uppercase tracking-[0.2em] text-court-text">
          Onchain Evidence Folder
        </h3>
        <span className="ml-auto text-[0.6rem] uppercase tracking-[0.15em] text-muted-foreground">
          {items.length} exhibits
        </span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {items.map((it, i) => (
          <div key={i} className="border border-court-line bg-court-surface">
            <button
              type="button"
              onClick={() => setOpen((o) => o.map((v, j) => (j === i ? !v : v)))}
              className="w-full flex items-center gap-2 px-3 py-2 text-left"
            >
              <span className="text-[0.55rem] uppercase tracking-[0.15em] text-court-gold border border-court-gold/40 px-1.5 py-0.5">
                {it.tag}
              </span>
              <span className="text-[0.7rem] uppercase tracking-[0.12em] text-muted-foreground truncate">
                {it.label}
              </span>
              <ChevronDown className={cn("h-3.5 w-3.5 ml-auto text-muted-foreground transition-transform", open[i] && "rotate-180")} />
            </button>
            <div className="px-3 pb-3">
              <div className="font-mono font-semibold text-xl text-court-text">{it.value}</div>
              {open[i] && <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{it.detail}</p>}
            </div>
          </div>
        ))}
      </div>

      {sources.length > 0 && (
        <div className="mt-3 border-t border-court-line pt-2">
          <p className="text-[0.55rem] uppercase tracking-[0.18em] text-muted-foreground mb-1">
            Sources consulted
          </p>
          <ul className="font-mono text-[0.65rem] text-court-text/70 space-y-0.5">
            {sources.map((s, i) => (
              <li key={i} className="truncate">{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}