import { useState, useCallback, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Search, AlertTriangle, CheckCircle2, XCircle, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { NETWORK_OPTIONS } from "@/lib/chains";

const COHORTS = [
  { value: "top_performers", label: "Top Performers" },
  { value: "bottom_performers", label: "Bottom Performers" },
  { value: "high_activity", label: "High Activity" },
  { value: "lower_activity", label: "Lower Activity" }
];

const TIMEFRAMES = [
  { value: 1, label: "1 day" },
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" }
];

const SCREENING_LABELS = {
  eligible: { text: "Eligible", color: "text-court-chart", border: "border-court-chart" },
  needs_review: { text: "Needs Review", color: "text-yellow-400", border: "border-yellow-400/50" },
  excluded: { text: "Excluded", color: "text-court-red", border: "border-court-red/50" }
};

const STATUS_COLORS = {
  discovered: "text-court-ice",
  approved: "text-court-chart",
  rejected: "text-court-red",
  queued: "text-court-chart",
  skipped: "text-court-mute"
};

const MAX_SELECT = 50;

// Candidate Discovery: sources wallets from the Nansen Smart Money PnL
// Leaderboard for calibration. Admin-only. One physical request per discovery.
// Never automatically queues or analyzes wallets. Supports bulk approval of
// up to 50 eligible candidates with a confirmation preview step.
export default function CandidateDiscovery({ verifiedTotal, target, onCandidatesQueued }) {
  const [network, setNetwork] = useState("ethereum");
  const [cohort, setCohort] = useState("top_performers");
  const [timeframe, setTimeframe] = useState(30);
  const [limit, setLimit] = useState(20);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [recentDiscoveries, setRecentDiscoveries] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [approving, setApproving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [preview, setPreview] = useState(null);
  const [duplicateWarning, setDuplicateWarning] = useState(null);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await base44.functions.invoke("getCalibrationCandidates", {});
      if (res?.data?.error) { setError(res.data.error); return; }
      setCandidates(res?.data?.candidates || []);
      setRecentDiscoveries(res?.data?.recent_discoveries || []);
    } catch (e) {
      setError(e?.message || "Failed to load candidates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCandidates(); }, [loadCandidates]);

  async function handleDiscover() {
    if (!confirmed) return;
    setDiscovering(true);
    setError("");
    setResult(null);
    setDuplicateWarning(null);
    try {
      const res = await base44.functions.invoke("discoverCalibrationCandidates", {
        network, cohort, timeframe, limit, confirmed: true
      });
      const data = res?.data;
      if (data?.error) {
        setError(data.error);
        if (data.court_recess) setError("Provider is in Court Recess. Try again later.");
        return;
      }
      // Check for duplicate-discovery warning
      if (data?.duplicate_warning) {
        setDuplicateWarning(data.previous_discovery);
        return;
      }
      setResult(data);
      loadCandidates();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Discovery failed.");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleForceDiscover() {
    if (!confirmed) return;
    setDiscovering(true);
    setError("");
    setDuplicateWarning(null);
    try {
      const res = await base44.functions.invoke("discoverCalibrationCandidates", {
        network, cohort, timeframe, limit, confirmed: true, force: true
      });
      const data = res?.data;
      if (data?.error) {
        setError(data.error);
        return;
      }
      if (data?.duplicate_warning) {
        setDuplicateWarning(data.previous_discovery);
        return;
      }
      setResult(data);
      loadCandidates();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Discovery failed.");
    } finally {
      setDiscovering(false);
    }
  }

  function toggleSelect(candidateId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(candidateId)) next.delete(candidateId);
      else if (next.size < MAX_SELECT) next.add(candidateId);
      return next;
    });
    setPreview(null);
  }

  function selectAllEligible() {
    const eligible = candidates.filter((c) => c.review_status === "discovered" && c.screening === "eligible");
    const limited = eligible.slice(0, MAX_SELECT);
    setSelected(new Set(limited.map((c) => c.candidate_id)));
    setPreview(null);
  }

  function clearSelection() {
    setSelected(new Set());
    setPreview(null);
  }

  async function handlePreview() {
    if (selected.size === 0) return;
    setApproving(true);
    setError("");
    try {
      const res = await base44.functions.invoke("approveCalibrationCandidates", {
        candidate_ids: Array.from(selected),
        preview: true
      });
      const data = res?.data;
      if (data?.error) { setError(data.error); return; }
      setPreview(data);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Preview failed.");
    } finally {
      setApproving(false);
    }
  }

  async function handleApprove() {
    if (selected.size === 0) return;
    setApproving(true);
    setError("");
    try {
      const res = await base44.functions.invoke("approveCalibrationCandidates", {
        candidate_ids: Array.from(selected)
      });
      const data = res?.data;
      if (data?.error) { setError(data.error); return; }
      setSelected(new Set());
      setPreview(null);
      loadCandidates();
      if (onCandidatesQueued) onCandidatesQueued();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Approval failed.");
    } finally {
      setApproving(false);
    }
  }

  async function handleReject(candidateId) {
    try {
      await base44.functions.invoke("rejectCalibrationCandidate", {
        candidate_id: candidateId
      });
      loadCandidates();
    } catch (e) {
      setError(e?.message || "Reject failed.");
    }
  }

  const remaining = Math.max(0, target - verifiedTotal);
  const discoveredCandidates = candidates.filter((c) => c.review_status === "discovered");
  const eligibleCount = discoveredCandidates.filter((c) => c.screening === "eligible").length;

  return (
    <div className="border-2 border-court-chart/60 bg-court-navy p-5">
      <h3 className="font-display uppercase text-court-chart text-xl mb-1">Candidate Discovery</h3>
      <p className="font-mono text-xs text-court-mute mb-4">
        Source wallets from the Nansen Smart Money PnL Leaderboard. One physical request per discovery.
      </p>

      {/* Budget bar */}
      <div className="grid grid-cols-3 gap-2 mb-4 font-mono text-sm">
        <div className="border-2 border-court-ice/40 p-2">
          <p className="text-xs uppercase text-court-mute">Verified</p>
          <p className="text-court-ice">{verifiedTotal} / {target}</p>
        </div>
        <div className="border-2 border-court-ice/40 p-2">
          <p className="text-xs uppercase text-court-mute">Remaining</p>
          <p className="text-court-chart">{remaining}</p>
        </div>
        <div className="border-2 border-court-ice/40 p-2">
          <p className="text-xs uppercase text-court-mute">Est. Calls</p>
          <p className="text-court-ice">1</p>
        </div>
      </div>

      {/* Discovery form */}
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="font-mono text-xs uppercase text-court-mute block mb-1">Network</label>
          <select value={network} onChange={(e) => setNetwork(e.target.value)} disabled={discovering}
            className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-2 border-2 border-court-ice/40 focus:border-court-chart outline-none">
            {NETWORK_OPTIONS.map((n) => (
              <option key={n.id} value={n.id}>{n.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="font-mono text-xs uppercase text-court-mute block mb-1">Cohort</label>
          <select value={cohort} onChange={(e) => setCohort(e.target.value)} disabled={discovering}
            className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-2 border-2 border-court-ice/40 focus:border-court-chart outline-none">
            {COHORTS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="font-mono text-xs uppercase text-court-mute block mb-1">Timeframe</label>
          <select value={timeframe} onChange={(e) => setTimeframe(parseInt(e.target.value, 10))} disabled={discovering}
            className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-2 border-2 border-court-ice/40 focus:border-court-chart outline-none">
            {TIMEFRAMES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="font-mono text-xs uppercase text-court-mute block mb-1">Result Limit (max 50)</label>
          <input type="number" min="1" max="50" value={limit}
            onChange={(e) => setLimit(Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)))}
            disabled={discovering}
            className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-2 border-2 border-court-ice/40 focus:border-court-chart outline-none" />
        </div>
      </div>

      <label className="flex items-start gap-2 mb-3 cursor-pointer">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={discovering}
          className="mt-0.5" />
        <span className="font-mono text-sm text-court-ice">
          I understand this makes a real Nansen API request and counts toward the contest ledger.
        </span>
      </label>

      <button type="button" onClick={handleDiscover} disabled={!confirmed || discovering || remaining <= 0}
        className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-mono text-sm uppercase tracking-[0.1em] px-4 py-2 border-2 border-court-navy hover:bg-court-ice transition-colors disabled:opacity-50">
        {discovering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
        Discover Candidates
      </button>

      {/* Duplicate-discovery warning */}
      {duplicateWarning && (
        <div className="mt-3 border-2 border-yellow-400 bg-court-navy p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-400" />
            <div className="flex-1">
              <p className="font-mono text-sm text-yellow-400 mb-1">This discovery was already run recently.</p>
              <div className="font-mono text-xs text-court-mute space-y-0.5 mb-3">
                <p>When: {duplicateWarning.discovered_at ? new Date(duplicateWarning.discovered_at).toLocaleString() : "Unknown"}</p>
                <p>Candidates found: {duplicateWarning.candidates_found ?? 0}</p>
                <p>Still eligible: {duplicateWarning.remaining_eligible ?? 0}</p>
                <p>Already queued or tried: {duplicateWarning.already_queued_or_tried ?? 0}</p>
                <p>Query: {duplicateWarning.network} · {duplicateWarning.cohort} · {duplicateWarning.timeframe_days}d · limit {duplicateWarning.result_limit}</p>
              </div>
              <button type="button" onClick={handleForceDiscover} disabled={!confirmed || discovering}
                className="inline-flex items-center gap-2 border-2 border-court-red text-court-red font-mono text-xs uppercase px-3 py-1.5 hover:bg-court-red hover:text-court-ice transition-colors disabled:opacity-50">
                {discovering ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                Run Again
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-court-red" />
          <span className="font-mono text-sm text-court-red">{error}</span>
        </div>
      )}

      {/* Discovery result stats */}
      {result && (
        <div className="mt-4 border-2 border-court-mute/40 p-4">
          <p className="font-display uppercase text-court-chart text-sm mb-2">Discovery Result</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-sm">
            <Stat label="Returned" value={result.total_returned} />
            <Stat label="Eligible" value={result.eligible} color="text-court-chart" />
            <Stat label="Excluded" value={result.excluded_services} color="text-court-red" />
            <Stat label="Needs Review" value={result.needs_review} color="text-yellow-400" />
            <Stat label="Duplicates" value={result.duplicate_in_batch} />
            <Stat label="Already Candidate" value={result.already_candidate} />
            <Stat label="Already Queued" value={result.already_queued} />
            <Stat label="Already Tried" value={result.already_tried} />
          </div>
          <div className="mt-2 font-mono text-xs text-court-mute">
            Stored {result.stored} new candidates · {result.physical_calls_used} physical call(s) · Verified total: {result.verified_total}
          </div>
        </div>
      )}

      {/* Candidate list */}
      <div className="mt-5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <p className="font-mono text-xs uppercase text-court-mute">
            Discovered Candidates ({discoveredCandidates.length})
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={selectAllEligible}
              className="font-mono text-xs uppercase text-court-chart hover:text-court-ice border border-court-chart/40 px-2 py-1">
              Select All Eligible ({Math.min(eligibleCount, MAX_SELECT)})
            </button>
            {selected.size > 0 && (
              <button type="button" onClick={clearSelection}
                className="font-mono text-xs uppercase text-court-mute hover:text-court-ice border border-court-mute/40 px-2 py-1">
                Clear
              </button>
            )}
            {selected.size > 0 && !preview && (
              <button type="button" onClick={handlePreview} disabled={approving}
                className="inline-flex items-center gap-1 border-2 border-court-chart text-court-chart font-mono text-xs uppercase px-3 py-1.5 hover:bg-court-chart hover:text-court-navy transition-colors disabled:opacity-50">
                {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Preview ({selected.size})
              </button>
            )}
          </div>
        </div>

        {/* Preview confirmation */}
        {preview && (
          <div className="mb-3 border-2 border-court-chart p-3">
            <p className="font-display uppercase text-court-chart text-sm mb-2">Approval Preview</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-sm mb-3">
              <Stat label="Selected" value={preview.selected_count} />
              <Stat label="New Unique" value={preview.new_unique} color="text-court-chart" />
              <Stat label="Already Queued" value={preview.already_queued} />
              <Stat label="Already Tried" value={preview.already_tried} />
              <Stat label="Existing Candidate" value={preview.existing_candidate} />
              <Stat label="Invalid/Excluded" value={preview.invalid_or_excluded} color="text-court-red" />
            </div>
            <p className="font-mono text-xs text-court-mute mb-3">
              Estimated analysis calls: ~{preview.estimated_analysis_calls} physical Nansen requests
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={handleApprove} disabled={approving || preview.new_unique === 0}
                className="inline-flex items-center gap-1 bg-court-chart text-court-navy font-mono text-xs uppercase px-3 py-1.5 border-2 border-court-navy hover:bg-court-ice transition-colors disabled:opacity-50">
                {approving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Approve & Queue ({preview.new_unique})
              </button>
              <button type="button" onClick={() => setPreview(null)}
                className="font-mono text-xs uppercase text-court-mute hover:text-court-ice px-3 py-1.5">
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading && <p className="font-mono text-sm text-court-mute animate-blink">Loading candidates…</p>}

        {!loading && discoveredCandidates.length === 0 && (
          <div className="border-2 border-dashed border-court-mute p-4 text-center">
            <p className="font-mono text-sm text-court-mute">No discovered candidates. Run a discovery to find wallets.</p>
          </div>
        )}

        {!loading && discoveredCandidates.length > 0 && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {discoveredCandidates.map((c) => {
              const screening = SCREENING_LABELS[c.screening] || SCREENING_LABELS.eligible;
              const isSelected = selected.has(c.candidate_id);
              const isExcluded = c.screening === "excluded";
              const maxReached = selected.size >= MAX_SELECT && !isSelected;
              return (
                <div key={c.candidate_id} className={cn("border-2 p-3", isSelected ? "border-court-chart bg-court-chart/10" : "border-court-ice/20")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      <input type="checkbox" checked={isSelected}
                        onChange={() => toggleSelect(c.candidate_id)}
                        disabled={isExcluded || maxReached}
                        className="mt-1" />
                      <div>
                        <p className="font-mono text-sm text-court-ice">{c.address_short}</p>
                        <p className="font-mono text-xs text-court-mute">{c.network} · {c.wallet_class}</p>
                        <p className="font-mono text-xs text-court-mute">
                          PnL: ${Math.round(c.ranking_metrics?.total_pnl_usd || 0).toLocaleString()} · Trades: {c.ranking_metrics?.n_trades || 0} · Win: {((c.ranking_metrics?.win_rate || 0) * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("font-mono text-xs uppercase px-2 py-0.5 border", screening.color, screening.border)}>
                        {screening.text}
                      </span>
                      <button type="button" onClick={() => handleReject(c.candidate_id)}
                        className="text-court-red hover:text-court-ice transition-colors" title="Reject">
                        <XCircle className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Advanced: show all candidates including queued/rejected */}
      <div className="mt-4">
        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
          className="inline-flex items-center gap-1 font-mono text-xs uppercase text-court-mute hover:text-court-ice">
          {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          All Candidates ({candidates.length})
        </button>
        {showAdvanced && (
          <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
            {candidates.filter((c) => c.review_status !== "discovered").map((c) => (
              <div key={c.candidate_id} className="flex items-center justify-between font-mono text-xs border-b border-court-ice/10 py-1">
                <span className="text-court-ice">{c.address_short}</span>
                <span className={cn(STATUS_COLORS[c.review_status] || "text-court-mute")}>
                  {c.review_status}{c.skip_reason ? ` · ${c.skip_reason}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent discoveries */}
      {recentDiscoveries.length > 0 && (
        <div className="mt-4 border-t border-court-ice/20 pt-3">
          <p className="font-mono text-xs uppercase text-court-mute mb-1">Recent Discoveries</p>
          <div className="space-y-0.5 max-h-32 overflow-y-auto">
            {recentDiscoveries.slice(0, 10).map((d) => (
              <div key={d.discovery_id} className="flex items-center justify-between font-mono text-xs text-court-mute">
                <span>{d.network} · {d.cohort} · {d.timeframe_days}d</span>
                <span>{d.candidates_found} found · {d.discovered_at ? new Date(d.discovered_at).toLocaleDateString() : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color = "text-court-ice" }) {
  return (
    <div>
      <span className="text-court-mute text-xs">{label}: </span>
      <span className={cn("font-bold", color)}>{value}</span>
    </div>
  );
}