import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

const SHAME_SECTIONS = [
  { key: "most_severe", title: "Most Severe" },
  { key: "highest_confidence", title: "Highest Confidence" },
  { key: "recently_convicted", title: "Recently Convicted" },
  { key: "one_pump_wonders", title: "One Pump Wonders" },
];

const HONORS = [
  { title: "Bag of the Day", desc: "The single worst-timed entry of the day, measured against Nansen trade data." },
  { title: "Dump of the Day", desc: "The most spectacular exit right before the move continued." },
  { title: "Escape Artist", desc: "The wallet that slipped out of a doomed position with the least damage." },
  { title: "Comeback Wallet", desc: "The clearest recovery from a historically terrible record." },
  { title: "Court Favorite", desc: "The wallet the court secretly respects — disciplined, boring, and profitable." },
];

function CaseCard({ c }) {
  const isLive = c.data_mode === "live";
  const date = c.analyzed_at ? new Date(c.analyzed_at).toLocaleDateString() : "—";
  return (
    <Link
      to={`/case/${c.slug}`}
      className="block border-2 border-court-ice bg-court-navy p-4 hover:border-court-chart transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs text-court-ice">{c.address_short}</span>
        <span
          className={cn(
            "font-mono text-xs uppercase tracking-[0.12em] px-1.5 py-0.5 border",
            isLive ? "border-court-chart text-court-chart" : "border-court-red text-court-red"
          )}
        >
          {isLive ? "Live" : "Demo"}
        </span>
      </div>
      <p className="font-display uppercase text-court-ice text-base leading-tight mb-3">{c.verdict_name}</p>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 font-mono text-xs text-court-mute">
        <span>{c.network}</span>
        <span>Sev {c.severity_score?.toFixed(0)}</span>
        <span>Conf {c.confidence_score?.toFixed(0)}%</span>
        <span>{date}</span>
      </div>
    </Link>
  );
}

export default function Hall() {
  const [tab, setTab] = useState("shame");
  const [sections, setSections] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await base44.functions.invoke("getHallOfShame", {});
        if (!alive) return;
        if (res?.data?.error) {
          setError(res.data.error);
          setStatus("error");
          return;
        }
        setSections(res.data.sections);
        setStatus("done");
      } catch (e) {
        setError(e?.message || "The docket could not be loaded.");
        setStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="mx-auto max-w-5xl px-4 pt-10 sm:pt-14 pb-24">
      <header className="text-center mb-8">
        <h1
          className="font-display uppercase leading-[0.86] text-court-ice"
          style={{ fontSize: "clamp(2.2rem, 6vw, 4rem)" }}
        >
          The Hall
        </h1>
        <p className="mt-4 font-mono text-base text-court-ice max-w-xl mx-auto leading-relaxed">
          Public record of convicted wallets. Sanitized addresses only — no private data is ever exposed.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 max-w-md mx-auto mb-10">
        {[
          { id: "shame", label: "Hall of Shame" },
          { id: "honor", label: "Hall of Honor" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "font-display uppercase tracking-[0.08em] text-sm py-3 border-2 transition-colors",
              tab === t.id
                ? "bg-court-chart text-court-navy border-court-chart shadow-[3px_3px_0_0_#FF3B30]"
                : "bg-court-navy text-court-ice border-court-ice hover:bg-court-uv"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "shame" ? (
        <HallOfShame sections={sections} status={status} error={error} />
      ) : (
        <HallOfHonor />
      )}
    </section>
  );
}

function HallOfShame({ sections, status, error }) {
  if (status === "loading") {
    return <p className="text-center font-mono text-base text-court-ice animate-blink">Convening the docket…</p>;
  }
  if (status === "error") {
    return (
      <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-4 py-3 text-sm text-court-red max-w-xl mx-auto">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <span className="font-mono leading-relaxed">{error}</span>
      </div>
    );
  }
  if (!sections) return null;

  return (
    <div className="space-y-12">
      <p className="text-center font-mono text-sm text-court-ice leading-relaxed max-w-2xl mx-auto">
        Rankings are built from public case records. Demo cases are clearly labeled and never presented as live Nansen results.
      </p>
      {SHAME_SECTIONS.map((s) => {
        const items = sections[s.key] || [];
        return (
          <div key={s.key}>
            <h2 className="font-display uppercase tracking-[0.08em] text-court-ice text-xl mb-4 border-b-2 border-court-chart pb-2">
              {s.title}
            </h2>
            {items.length === 0 ? (
              <p className="font-mono text-sm text-court-mute">No cases in this category yet.</p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((c) => (
                  <CaseCard key={c.slug} c={c} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HallOfHonor() {
  return (
    <div>
      <div className="border-2 border-court-chart bg-court-navy p-5 sm:p-6 mb-8 text-center">
        <p className="font-display uppercase tracking-[0.06em] text-court-chart text-xl sm:text-2xl mb-2">
          Court Honors Coming Next
        </p>
        <p className="font-mono text-base text-court-ice leading-relaxed max-w-2xl mx-auto">
          Honors will be awarded only from eligible live Nansen cases. No demo wallets qualify, and no winners are fabricated.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {HONORS.map((h) => (
          <div key={h.title} className="border-2 border-court-ice bg-court-navy p-5">
            <h3 className="font-display uppercase tracking-[0.06em] text-court-ice text-lg mb-2">{h.title}</h3>
            <p className="font-mono text-sm text-court-mute leading-relaxed">{h.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}