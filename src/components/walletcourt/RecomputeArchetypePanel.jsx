import { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { AlertTriangle, Loader2, RotateCcw, ExternalLink, Check } from "lucide-react";

// Admin-only panel for recomputing the canonical archetype classification
// of a completed single-trade trial. Uses zero Nansen calls — recomputes
// from stored metrics only.
export default function RecomputeArchetypePanel() {
  const [slug, setSlug] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function handleRecompute(e) {
    e.preventDefault();
    if (!slug.trim() || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await base44.functions.invoke("recomputeSingleTradeTrial", { slug: slug.trim() });
      if (res?.data?.error) {
        setError(res.data.error);
      } else {
        setResult(res.data);
      }
    } catch (e) {
      setError(e?.message || "Recompute failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-2 border-court-chart/50 bg-court-navy mb-6">
      <div className="flex items-center justify-between border-b-2 border-court-chart/50 px-4 sm:px-5 py-3">
        <h2 className="font-display uppercase tracking-[0.08em] text-court-chart text-base">Recompute Archetype</h2>
        <span className="font-mono text-xs text-court-mute/70">Zero Nansen calls · stored metrics only</span>
      </div>

      <div className="px-4 sm:px-5 py-4">
        <p className="font-mono text-xs text-court-mute mb-3 leading-relaxed">
          Recomputes the canonical archetype classification for a completed trial. If a comeback archetype
          (ESCAPE ARTIST, COMEBACK KID, BACK FROM THE DEAD) matches, the verdict is updated in place.
          Existing verdicts are NOT changed automatically — only when you trigger it here.
        </p>

        <form onSubmit={handleRecompute} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="enter case slug (e.g. trade-xxxxxxxx)"
            spellCheck={false}
            autoComplete="off"
            className="court-input flex-1 px-3 py-2.5 font-mono text-sm focus:outline-none"
          />
          <button
            type="submit"
            disabled={loading || !slug.trim()}
            className="inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Recompute
          </button>
        </form>

        {error && (
          <div className="mt-3 flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-2.5 text-sm text-court-red">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span className="font-mono leading-relaxed">{error}</span>
          </div>
        )}

        {result && (
          <div className="mt-3 border-2 border-court-mute/25 bg-court-navy/60 px-4 py-3">
            {result.recomputed ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <Check className="h-4 w-4 text-court-chart" />
                  <span className="font-mono text-sm text-court-chart font-semibold">Verdict updated</span>
                </div>
                <div className="font-mono text-xs space-y-1">
                  <p className="text-court-mute">
                    Previous: <span className="text-court-red">{result.previous_verdict_name || result.previous_verdict_code || "—"}</span>
                  </p>
                  <p className="text-court-mute">
                    New: <span className="text-court-chart">{result.new_verdict_name}</span>
                    {result.new_charge && <span className="text-court-ice"> · {result.new_charge}</span>}
                  </p>
                </div>
                {result.trial?.public_slug && (
                  <Link
                    to={`/trade/${result.trial.public_slug}`}
                    className="mt-2 inline-flex items-center gap-1 font-mono text-xs text-court-chart underline hover:brightness-125"
                  >
                    View updated case <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </>
            ) : (
              <div className="font-mono text-xs text-court-mute leading-relaxed">
                <p className="text-court-ice/80 mb-1">{result.reason}</p>
                <p>Existing verdict: <span className="text-court-ice">{result.existing_verdict_name || result.existing_verdict_code || "—"}</span></p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}