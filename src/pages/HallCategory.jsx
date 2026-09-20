import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import CaseCard from "@/components/walletcourt/CaseCard";
import HonorCard from "@/components/walletcourt/HonorCard";
import { CATEGORY_TITLES, CATEGORY_SLUG_TO_KEY as SLUG_TO_KEY } from "@/lib/hallSelection";
import { classifyHallCategoryResponse } from "@/lib/hallResponse";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";

const PAGE_SIZE = 12;

export default function HallCategory() {
  const { categorySlug } = useParams();
  const categoryKey = SLUG_TO_KEY[categorySlug];
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  const loadPage = useCallback(async (catKey, off, append) => {
    if (!catKey) return;
    if (!append) setStatus("loading");
    else setLoadingMore(true);
    setError("");
    try {
      const res = await base44.functions.invoke("getHallOfShame", {
        view: "category",
        category: catKey,
        offset: off,
        limit: PAGE_SIZE,
      });
      const result = classifyHallCategoryResponse(res?.data);

      if (result.status === "error") {
        console.warn("[HallCategory] Response error", { category: catKey, error: result.error });
        setError(result.error);
        setStatus("error");
        return;
      }

      // Valid category response — "items" or "empty" (intentional empty state)
      setItems((prev) => append ? [...prev, ...result.items] : result.items);
      setTotal(result.total);
      setOffset(result.offset);
      setHasMore(result.has_more);
      setStatus("done");
    } catch (e) {
      setError(e?.message || "The docket could not be loaded.");
      setStatus("error");
    } finally {
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    setItems([]);
    setOffset(0);
    loadPage(categoryKey, 0, false);
  }, [categoryKey, loadPage]);

  function handleLoadMore() {
    const nextOffset = offset + PAGE_SIZE;
    trackShare(SHARE_EVENTS.HALL_CATEGORY_LOAD_MORE, { category: categoryKey, offset: nextOffset });
    loadPage(categoryKey, nextOffset, true);
  }

  if (!categoryKey) {
    return (
      <section className="mx-auto max-w-xl px-4 pt-20 pb-24 text-center">
        <p className="font-display uppercase text-court-red text-3xl mb-4">Invalid category</p>
        <Link to="/hall" className="font-mono text-court-chart hover:text-court-ice underline">Back to The Hall</Link>
      </section>
    );
  }

  const isHonor = categoryKey === "honor";
  const title = CATEGORY_TITLES[categoryKey];

  return (
    <section className="mx-auto max-w-6xl px-4 pt-10 sm:pt-14 pb-24">
      <Link
        to="/hall"
        className="inline-flex items-center gap-1.5 font-mono text-sm uppercase tracking-[0.12em] text-court-chart hover:text-court-ice transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Back to The Hall
      </Link>

      <header className="mb-8">
        <h1
          className="font-display uppercase leading-[0.86] text-court-ice"
          style={{ fontSize: "clamp(1.8rem, 5vw, 3rem)" }}
        >
          {title}
        </h1>
        <p className="mt-3 font-mono text-base text-court-mute max-w-2xl leading-relaxed">
          {isHonor
            ? "Live Nansen cases with a positive NOT GUILTY verdict. No demo, dismissed, or fabricated winners."
            : "Public completed cases, ranked deterministically. Sanitized addresses only."}
        </p>
      </header>

      {status === "loading" && (
        <p className="text-center font-mono text-base text-court-ice animate-blink">Loading docket…</p>
      )}

      {status === "error" && (
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-4 py-3 text-base text-court-red max-w-xl mx-auto">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="font-mono leading-relaxed">{error}</span>
        </div>
      )}

      {status === "done" && (
        <>
          {items.length === 0 ? (
            <div className="border-2 border-dashed border-court-mute bg-court-navy p-8 text-center">
              <p className="font-display uppercase tracking-[0.06em] text-court-mute text-xl mb-2">
                {isHonor ? "No honored wallets yet" : "No cases in this category"}
              </p>
              <p className="font-mono text-base text-court-mute leading-relaxed max-w-xl mx-auto">
                {isHonor
                  ? "Honors are awarded only from eligible live Nansen cases with a NOT GUILTY verdict. No winners are fabricated."
                  : "Cases will appear here once they are completed and qualify for this category."}
              </p>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 auto-rows-fr gap-4">
                {items.map((c, i) =>
                  isHonor ? (
                    <HonorCard key={c.slug} c={c} />
                  ) : (
                    <CaseCard key={c.slug} c={c} rank={offset + i + 1} />
                  )
                )}
              </div>

              {hasMore && (
                <div className="mt-8 text-center">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-6 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-60"
                  >
                    {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                    {loadingMore ? "Loading…" : "Load More"}
                  </button>
                </div>
              )}

              <p className="mt-6 text-center font-mono text-sm text-court-mute">
                Showing {items.length} of {total}
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}