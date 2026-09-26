import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowRight } from "lucide-react";
import CaseCard from "@/components/walletcourt/CaseCard";
import HonorCard from "@/components/walletcourt/HonorCard";
import DailyAwards from "@/components/walletcourt/DailyAwards";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";
import { CATEGORY_SEE_ALL, CATEGORY_TITLES, CATEGORY_ROUTES } from "@/lib/hallSelection";

const SUMMARY_SECTIONS = [
  { key: "most_severe", title: "Most Severe" },
  { key: "highest_confidence", title: "Highest Confidence" },
  { key: "recent", title: "Recent Cases" },
  { key: "recovery", title: "Recovery" },
  { key: "honor", title: "Hall of Honor" },
];

export default function Hall() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await base44.functions.invoke("getHallOfShame", { view: "summary" });
        if (!alive) return;
        if (res?.data?.error) {
          setError(res.data.error);
          setStatus("error");
          return;
        }
        setData(res.data);
        setStatus("done");
      } catch (e) {
        setError(e?.message || "The docket could not be loaded.");
        setStatus("error");
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <section className="mx-auto max-w-6xl px-4 pt-10 sm:pt-14 pb-24">
      <header className="text-center mb-8">
        <h1
          className="font-display uppercase leading-[0.86] text-court-ice"
          style={{ fontSize: "clamp(2.2rem, 6vw, 4rem)" }}
        >
          The Hall
        </h1>
        <p className="mt-4 font-mono text-base text-court-ice max-w-xl mx-auto leading-relaxed">
          Public record of Wallet Court cases. Sanitized addresses only — no private data is ever exposed.
        </p>
      </header>

      {status === "loading" && (
        <p className="text-center font-mono text-base text-court-ice animate-blink">Convening the docket…</p>
      )}

      {status === "error" && (
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-4 py-3 text-base text-court-red max-w-xl mx-auto">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="font-mono leading-relaxed">{error}</span>
        </div>
      )}

      {status === "done" && data && (
        <div className="space-y-12">
          {/* Daily Court Awards */}
          <div>
            <h2 className="font-display uppercase tracking-[0.08em] text-court-ice text-xl mb-4 border-b-2 border-court-chart pb-2">
              Daily Court Awards
            </h2>
            <DailyAwards bag={data.daily_awards?.bag} dump={data.daily_awards?.dump} />
          </div>

          {/* Curated sections — max 3 cards each */}
          {SUMMARY_SECTIONS.map((s) => {
            const items = data.sections?.[s.key] || [];
            const seeAllRoute = CATEGORY_ROUTES[s.key];
            return (
              <div key={s.key}>
                <div className="flex items-center justify-between mb-4 border-b-2 border-court-chart pb-2">
                  <h2 className="font-display uppercase tracking-[0.08em] text-court-ice text-xl">
                    {s.title}
                  </h2>
                  <Link
                    to={seeAllRoute}
                    onClick={() => trackShare(SHARE_EVENTS.HALL_CATEGORY_SEE_ALL, { category: s.key })}
                    className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-[0.12em] text-court-chart hover:text-court-ice transition-colors"
                  >
                    {CATEGORY_SEE_ALL[s.key]}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                {items.length === 0 ? (
                  <p className="font-mono text-base text-court-mute">
                    {s.key === "honor"
                      ? "No eligible live NOT GUILTY cases yet. Honors are awarded only from real Nansen evidence — no fabricated winners."
                      : s.key === "recovery"
                      ? "No recovery stories yet. Journey archetypes (Escape Artist, Comeback Kid, Back From the Dead, Almost Escaped) appear here once live cases are completed."
                      : "No cases in this category yet."}
                  </p>
                ) : (
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-4">
                    {items.map((c, i) =>
                      s.key === "honor" ? (
                        <HonorCard key={c.slug} c={c} />
                      ) : (
                        <CaseCard key={c.slug} c={c} rank={i + 1} />
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}