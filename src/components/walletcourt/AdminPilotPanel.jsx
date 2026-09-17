import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { publicClassLabel } from "@/lib/walletClass";
import { AlertTriangle, Loader2, Check, X, RefreshCw, Eye } from "lucide-react";

const CONFIRM_PHRASE = "SPEND LABEL CREDITS";

// Admin-only: pilot review table (item N2.6) + label-only backfill (item N2.7).
// Address Labels costs 100 Nansen credits per uncached wallet, so the backfill
// requires an explicit preview, a cost warning, a confirmation checkbox, and
// the typed phrase "SPEND LABEL CREDITS" before any call is made.
export default function AdminPilotPanel() {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);
  const [refresh, setRefresh] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);

  const confirmed = confirmChecked && confirmText.trim() === CONFIRM_PHRASE;

  async function load() {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("getPilotReview", {});
      if (res?.data?.error) setError(res.data.error);
      else { setItems(res.data.items || []); setError(""); }
    } catch (e) {
      setError(e?.message || "Failed to load pilot review.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function toggle(slug) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(slug)) n.delete(slug); else n.add(slug);
      return n;
    });
  }

  async function doPreview() {
    const slugs = [...selected];
    if (slugs.length === 0) { setError("Select at least one case to preview."); return; }
    setPreview(null); setResults(null); setError("");
    try {
      const res = await base44.functions.invoke("enrichCasesWithLabels", { case_slugs: slugs, preview: true, refresh });
      if (res?.data?.error) setError(res.data.error);
      else setPreview(res.data);
    } catch (e) {
      setError(e?.message || "Preview failed.");
    }
  }

  async function doRun() {
    if (!confirmed) { setError(`Check the confirmation box and type ${CONFIRM_PHRASE} to spend label credits.`); return; }
    const slugs = [...selected];
    if (slugs.length === 0) { setError("Select at least one case to enrich."); return; }
    setRunning(true); setResults(null); setError("");
    try {
      const res = await base44.functions.invoke("enrichCasesWithLabels", { case_slugs: slugs, preview: false, refresh, confirm: confirmText.trim() });
      if (res?.data?.error) setError(res.data.error);
      else setResults(res.data.results || []);
      setConfirmText(""); setConfirmChecked(false);
      await load();
    } catch (e) {
      setError(e?.message || "Backfill failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Pilot review table */}
      <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5">
        <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg mb-3">Pilot Review</h2>
        <p className="font-mono text-sm text-court-ice leading-relaxed mb-4">
          Every analyzed wallet: class, verdict, scores, and endpoint outcomes. Select live cases to enrich with Nansen labels (one labels call each — no performance calls).
        </p>
        {loading ? (
          <p className="font-mono text-base text-court-ice animate-blink">Loading pilot review…</p>
        ) : error && !items ? (
          <div className="flex items-start gap-2 text-sm text-court-red"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span className="font-mono">{error}</span></div>
        ) : (items || []).length === 0 ? (
          <p className="font-mono text-base text-court-mute">No completed cases yet.</p>
        ) : (
          <div className="overflow-x-auto border-2 border-court-mute/40">
            <table className="w-full font-mono text-xs">
              <thead className="bg-court-uv text-court-ice uppercase tracking-[0.1em]">
                <tr>
                  <th className="p-2 text-left w-8"></th>
                  <th className="p-2 text-left">Address</th>
                  <th className="p-2 text-left">Mode</th>
                  <th className="p-2 text-left">Class</th>
                  <th className="p-2 text-left">Verdict</th>
                  <th className="p-2 text-left">Sev</th>
                  <th className="p-2 text-left">Conf</th>
                  <th className="p-2 text-left">OK Endpoints</th>
                  <th className="p-2 text-left">Failed</th>
                  <th className="p-2 text-left">Case</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.case_slug} className="border-t border-court-mute/40 text-court-ice align-top">
                    <td className="p-2"><input type="checkbox" checked={selected.has(it.case_slug)} onChange={() => toggle(it.case_slug)} disabled={it.data_mode !== "live"} className="accent-court-chart" /></td>
                    <td className="p-2 whitespace-nowrap">{it.address_short}</td>
                    <td className={cn("p-2 uppercase", it.data_mode === "live" ? "text-court-chart" : "text-court-red")}>{it.data_mode}</td>
                    <td className="p-2">{publicClassLabel(it.wallet_class)}</td>
                    <td className="p-2">{it.verdict_name}</td>
                    <td className="p-2">{it.severity_score != null ? it.severity_score.toFixed(0) : "—"}</td>
                    <td className="p-2">{it.confidence_score != null ? it.confidence_score.toFixed(0) + "%" : "—"}</td>
                    <td className="p-2 text-court-chart">{it.successful_endpoints?.join(", ") || "—"}</td>
                    <td className="p-2 text-court-red">{it.failed_endpoints?.join(", ") || "—"}</td>
                    <td className="p-2"><Link to={`/case/${it.case_slug}`} className="inline-flex items-center gap-1 text-court-chart hover:underline"><Eye className="h-3.5 w-3.5" />View</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Label-only backfill */}
      <div className="border-2 border-court-chart bg-court-navy p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-3">
          <RefreshCw className="h-5 w-5 text-court-chart" />
          <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-lg">Enrich Existing Cases With Nansen Labels</h2>
        </div>
        <p className="font-mono text-sm text-court-ice leading-relaxed mb-3">
          Calls only the Address Labels endpoint per selected case, reuses saved performance evidence, and recomputes classification, verdict, roast, sentence, severity, and confidence. Permanent case slugs are preserved. One real Nansen call per uncached wallet — no performance calls.
        </p>
        <div className="border-2 border-court-red bg-court-uv/40 px-3 py-2 mb-4 font-mono text-sm text-court-ice leading-relaxed">
          ⚠ Address Labels costs <span className="text-court-red font-bold">100 Nansen credits</span> per uncached wallet. Preview first, then confirm before spending.
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="inline-flex items-center gap-2 font-mono text-sm text-court-ice cursor-pointer">
            <input type="checkbox" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} className="accent-court-chart" />
            Refresh Labels (re-fetch stale cached entries &gt; 30 days)
          </label>
          <button type="button" onClick={doPreview} disabled={running || selected.size === 0}
            className="inline-flex items-center gap-2 bg-court-uv text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-ice disabled:opacity-60">
            Preview Expected Calls
          </button>
          <span className="font-mono text-sm text-court-ice">{selected.size} selected</span>
        </div>

        {error && <div className="flex items-start gap-2 border-2 border-court-red px-3 py-2 text-sm text-court-red mb-4"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span className="font-mono">{error}</span></div>}

        {preview && (
          <div className="border-2 border-court-mute/40 p-3 mb-4 font-mono text-sm text-court-ice space-y-1">
            <p className="text-court-red">{preview.cost_warning}</p>
            <p>Selected cases: <span className="text-court-chart">{preview.eligible}</span> / {preview.requested}</p>
            <p>Already cached (fresh, 0 calls): <span className="text-court-chart">{preview.already_cached}</span></p>
            <p>Eligible for refresh (stale &gt; 30d): <span className="text-court-chart">{preview.eligible_for_refresh}</span></p>
            <p>New label calls required: <span className="text-court-red font-bold">{preview.new_label_calls}</span></p>
            <p>Documented estimated credit cost: <span className="text-court-red font-bold">{preview.estimated_credit_cost}</span> ({preview.label_credit_cost_each} each)</p>
            <p>Current known credit balance: <span className="text-court-chart">{preview.credit_balance == null ? "—" : preview.credit_balance}</span></p>
            {preview.slugs_to_update?.length > 0 && (
              <p className="text-court-mute">Slugs to update: {preview.slugs_to_update.join(", ")}</p>
            )}
            {preview.ineligible?.length > 0 && <p className="text-court-red">Ineligible (not live/completed): {preview.ineligible.join(", ")}</p>}
          </div>
        )}

        {/* Confirmation gate */}
        <div className="border-2 border-court-chart/60 bg-court-navy p-3 mb-4">
          <p className="font-mono text-sm text-court-ice mb-2">To spend label credits, check the box and type <span className="text-court-chart font-bold">{CONFIRM_PHRASE}</span>:</p>
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
            <label className="inline-flex items-center gap-2 font-mono text-sm text-court-ice cursor-pointer">
              <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} className="accent-court-chart" />
              I understand this spends Nansen credits
            </label>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={CONFIRM_PHRASE}
              className="court-input flex-1 px-3 py-2 font-mono text-sm"
            />
          </div>
        </div>

        <button type="button" onClick={doRun} disabled={running || selected.size === 0 || !confirmed}
          className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] disabled:opacity-60">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {refresh ? "Run Refresh" : "Run Backfill"}
        </button>

        {results && (
          <div className="mt-4 border-2 border-court-mute/40 p-3 font-mono text-xs">
            <p className="uppercase tracking-[0.1em] text-court-mute mb-2">Backfill Results ({results.length})</p>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {results.map((r) => (
                <div key={r.case_slug} className="border-l-2 border-court-mute pl-2">
                  <div className="flex items-center gap-2">
                    {r.status === "enriched" ? <Check className="h-3.5 w-3.5 text-court-chart shrink-0" /> : <X className="h-3.5 w-3.5 text-court-red shrink-0" />}
                    <span className="text-court-ice">{r.case_slug}</span>
                    <span className={cn("ml-auto uppercase", r.status === "enriched" ? "text-court-chart" : "text-court-red")}>{r.status}</span>
                  </div>
                  {r.status === "enriched" && (
                    <p className="text-court-mute mt-1">
                      {r.before.verdict_name} ({r.before.wallet_class}) → {r.after.verdict_name} ({r.after.wallet_class}) · sev {r.before.severity_score}→{r.after.severity_score} · {r.labels_count} labels
                    </p>
                  )}
                  {r.status === "labels_failed" && <p className="text-court-red mt-1">{r.error_category} (HTTP {r.http_status})</p>}
                  {r.status === "skipped_cached" && <p className="text-court-mute mt-1">{r.reason}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}