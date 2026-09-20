import { Link } from "react-router-dom";
import { Send, ExternalLink, Download } from "lucide-react";
import { buildCaseUrl } from "@/lib/courtDispatch";

const STATUS_LABELS = {
  anonymous_defendant: "Anonymous Defendant",
  summons_ready: "Summons Ready",
  share_opened: "Share Opened",
  summons_served_self_reported: "Summons Served — Self-reported",
};

export default function AccountSummons({ summons }) {
  if (!summons || summons.length === 0) {
    return (
      <section>
        <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">My Summons</h2>
        <div className="border-2 border-court-ice bg-court-navy p-6 text-center">
          <Send className="h-8 w-8 text-court-mute mx-auto mb-3" />
          <p className="font-mono text-sm text-court-ice">
            No summons yet. Put a wallet on trial and serve a defendant to see it here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="font-display uppercase tracking-[0.06em] text-court-ice text-xl mb-3">My Summons</h2>
      <div className="space-y-2">
        {summons.map((s) => {
          const caseUrl = buildCaseUrl(s.case_slug);
          const statusLabel = STATUS_LABELS[s.status] || s.status;
          return (
            <div key={s.summons_id} className="border-2 border-court-ice bg-court-navy p-3">
              <div className="flex items-center gap-3">
                <Send className="h-5 w-5 text-court-chart shrink-0" />
                <div className="flex-1 min-w-0">
                  {s.display_handle ? (
                    <p className="font-display text-base text-court-ice">
                      @{s.display_handle}{" "}
                      <span className="font-mono text-xs text-court-mute">· Unverified</span>
                    </p>
                  ) : (
                    <p className="font-display text-base text-court-ice">Anonymous Defendant</p>
                  )}
                  <p className="font-mono text-xs text-court-mute">
                    {s.verdict_name || "Verdict"} · {s.network || ""} · {s.address_short || ""}
                  </p>
                  <p className="font-mono text-xs text-court-chart mt-0.5">{statusLabel}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  to={`/case/${s.case_slug}`}
                  className="inline-flex items-center gap-1.5 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-xs px-3 py-1.5 border-2 border-court-navy hover:brightness-105 transition-all"
                >
                  Open Case <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                <a
                  href={caseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 bg-court-navy text-court-ice font-display uppercase tracking-[0.08em] text-xs px-3 py-1.5 border-2 border-court-ice hover:bg-court-uv transition-colors"
                >
                  Share <Send className="h-3.5 w-3.5" />
                </a>
              </div>
              <p className="mt-1.5 font-mono text-xs text-court-mute">
                Created {new Date(s.created_at).toLocaleDateString()}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}