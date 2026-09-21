import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import {
  Loader2, Play, Pause, Square, AlertTriangle, CheckCircle2,
  RefreshCw, ExternalLink, Zap
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CAMPAIGN_SIZES, CAMPAIGN_STATUS_LABELS, CAMPAIGN_STATUS_COLORS,
  TERMINAL_STATUSES, ACTIVE_STATUSES, safeProgress, estimateCalls, AVG_CALLS_PER_WALLET
} from "@/lib/campaignProgress";

// Calibration Campaign Runner: processes up to N approved wallets sequentially
// through the existing processCalibrationWallet pipeline. Persists campaign
// state server-side so a browser refresh doesn't lose the run. Requires
// explicit RESUME after refresh — never resumes physical calls silently.
export default function CampaignRunner({ verifiedTotal, target, ceiling, pendingCount, onCampaignComplete }) {
  const [maxWallets, setMaxWallets] = useState(5);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [campaign, setCampaign] = useState(null);
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState([]);
  const [error, setError] = useState("");
  const [interrupted, setInterrupted] = useState(false);
  const [loadingState, setLoadingState] = useState(true);
  const stopRef = useRef(false);
  const pauseRef = useRef(false);
  const processingRef = useRef(false);

  // On mount: check for an interrupted campaign (browser refresh)
  const checkInterrupted = useCallback(async () => {
    setLoadingState(true);
    try {
      const res = await base44.functions.invoke("getCalibrationCampaign", {});
      const data = res?.data;
      if (data?.error) { setError(data.error); return; }
      if (data?.campaign && data.is_interrupted) {
        setCampaign(data.campaign);
        setProgress(data.progress);
        setResults(data.results || []);
        setInterrupted(true);
      } else if (data?.campaign && ACTIVE_STATUSES.has(data.campaign.status)) {
        setCampaign(data.campaign);
        setProgress(data.progress);
        setResults(data.results || []);
        if (data.campaign.status === "paused") {
          setInterrupted(true);
        }
      }
    } catch (e) {
      // Silent — no active campaign is the normal state
    } finally {
      setLoadingState(false);
    }
  }, []);

  useEffect(() => { checkInterrupted(); }, [checkInterrupted]);

  // The sequential processing loop. Processes one wallet at a time, then
  // advances the campaign to claim the next wallet.
  const processLoop = useCallback(async (runId, firstItem) => {
    let item = firstItem;
    const localResults = [];
    let walletIndex = 0;

    while (item && !stopRef.current && !pauseRef.current) {
      if (processingRef.current) break;
      processingRef.current = true;

      // Update current item display
      setCampaign((c) => c ? { ...c, current_item_id: item.docket_item_id, current_address_short: item.address_short, current_network: item.network } : c);

      const delayMs = walletIndex === 0 ? 0 : 2000;
      walletIndex++;

      let processData;
      try {
        const res = await base44.functions.invoke("processCalibrationWallet", {
          docket_item_id: item.docket_item_id,
          run_id: runId,
          delay_ms: delayMs
        });
        processData = res?.data || {};
        if (processData.error) {
          processData = { status: "failed", failure_message_safe: processData.error, physical_calls_used: 0 };
        }
      } catch (e) {
        processData = { status: "failed", failure_message_safe: e?.message || "Processing failed.", physical_calls_used: 0 };
      }

      localResults.push({ item, ...processData });
      setResults([...localResults]);
      processingRef.current = false;

      // Advance the campaign
      let advanceData;
      try {
        const res = await base44.functions.invoke("advanceCalibrationCampaign", {
          run_id: runId,
          item_result: processData
        });
        advanceData = res?.data || {};
        if (advanceData.error) {
          setError(advanceData.error);
          break;
        }
      } catch (e) {
        setError(e?.message || "Campaign advance failed.");
        break;
      }

      // Update campaign and progress
      setCampaign(advanceData.run);
      setProgress(advanceData.run ? {
        ...advanceData.run,
        verified_total: advanceData.verified_total || verifiedTotal,
        target,
        ceiling,
        remaining_to_target: Math.max(0, target - (advanceData.verified_total || verifiedTotal)),
        pending_queue: pendingCount,
        estimated_calls_remaining: advanceData.run?.max_wallets != null
          ? Math.max(0, advanceData.run.max_wallets - (advanceData.run.wallets_completed || 0)) * AVG_CALLS_PER_WALLET
          : 0
      } : null);

      // Check stop conditions
      if (advanceData.stop_reason || !advanceData.next_item) {
        if (advanceData.stop_reason && !stopRef.current && !pauseRef.current) {
          setError(advanceData.stop_reason);
        }
        break;
      }

      // Check if the campaign was paused/stopped by another tab
      if (advanceData.run && (advanceData.run.status === "paused" || advanceData.run.status === "stopped" || TERMINAL_STATUSES.has(advanceData.run.status))) {
        break;
      }

      item = advanceData.next_item;
    }

    setRunning(false);

    // Refresh campaign state
    try {
      const res = await base44.functions.invoke("getCalibrationCampaign", {});
      if (res?.data?.campaign) {
        setCampaign(res.data.campaign);
        setProgress(res.data.progress);
        setResults(res.data.results || []);
      }
    } catch {}

    if (onCampaignComplete) onCampaignComplete();
  }, [verifiedTotal, target, ceiling, pendingCount, onCampaignComplete]);

  async function handleStart() {
    if (!confirmed) return;
    setRunning(true);
    setError("");
    setResults([]);
    stopRef.current = false;
    pauseRef.current = false;
    setInterrupted(false);

    try {
      const res = await base44.functions.invoke("startCalibrationCampaign", {
        max_wallets: maxWallets === "all" ? null : maxWallets,
        confirmed: true
      });
      const data = res?.data;
      if (data?.error) {
        setError(data.error);
        setRunning(false);
        return;
      }

      setCampaign(data.run);
      setProgress({
        ...data.run,
        verified_total: data.verified_total,
        target,
        ceiling,
        remaining_to_target: Math.max(0, target - data.verified_total),
        campaign_wallets_completed: 0,
        campaign_wallets_selected: 1,
        pending_queue: pendingCount,
        estimated_calls_remaining: data.estimated_calls || 0,
        status: data.run?.status || "running",
        stop_reason: null
      });

      if (data.first_item) {
        await processLoop(data.run.run_id, data.first_item);
      } else {
        setRunning(false);
        setError("No items could be claimed.");
      }
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Campaign start failed.");
      setRunning(false);
    }
  }

  async function handleResume() {
    if (!campaign) return;
    setRunning(true);
    setError("");
    setInterrupted(false);
    stopRef.current = false;
    pauseRef.current = false;

    try {
      const res = await base44.functions.invoke("resumeCalibrationCampaign", {
        run_id: campaign.run_id,
        confirmed: true
      });
      const data = res?.data;
      if (data?.error) {
        setError(data.error);
        setRunning(false);
        return;
      }

      setCampaign(data.run);
      if (data.next_item) {
        await processLoop(data.run.run_id, data.next_item);
      } else {
        setRunning(false);
        if (data.stop_reason) setError(data.stop_reason);
      }
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Campaign resume failed.");
      setRunning(false);
    }
  }

  async function handlePause() {
    if (!campaign) return;
    pauseRef.current = true;
    try {
      await base44.functions.invoke("pauseCalibrationCampaign", { run_id: campaign.run_id });
    } catch (e) {
      setError(e?.message || "Pause failed.");
    }
  }

  async function handleStop() {
    if (!campaign) return;
    stopRef.current = true;
    try {
      await base44.functions.invoke("stopCalibrationCampaign", { run_id: campaign.run_id });
      setRunning(false);
      // Refresh state
      checkInterrupted();
    } catch (e) {
      setError(e?.message || "Stop failed.");
    }
  }

  const remaining = Math.max(0, target - verifiedTotal);
  const isTerminal = campaign && TERMINAL_STATUSES.has(campaign.status);
  const isActive = campaign && ACTIVE_STATUSES.has(campaign.status);
  const walletsToProcess = maxWallets === "all" ? pendingCount : Math.min(maxWallets, pendingCount);
  const estimatedCalls = estimateCalls(walletsToProcess);

  // Progress display (never impossible states)
  const completedProgress = campaign ? safeProgress(campaign.wallets_completed, campaign.wallets_selected) : null;

  return (
    <div className="border-2 border-court-chart bg-court-navy p-5">
      <h3 className="font-display uppercase text-court-chart text-xl mb-1">Calibration Campaign Runner</h3>
      <p className="font-mono text-xs text-court-mute mb-4">
        Process approved wallets sequentially through the real pipeline. State persists across refreshes.
      </p>

      {/* Contest integrity copy */}
      <div className="mb-4 border-l-4 border-court-chart pl-3">
        <p className="font-mono text-xs text-court-ice leading-relaxed">
          Every verified call is one physical outbound request to Nansen. Unique wallet analyses only. No backfill, estimates, demo counts, duplicate-wallet padding, or artificial retries.
        </p>
      </div>

      {/* Budget bar */}
      <div className="grid grid-cols-4 gap-2 mb-4 font-mono text-sm">
        <div className="border-2 border-court-ice/40 p-2">
          <p className="text-xs uppercase text-court-mute">Verified</p>
          <p className="text-court-ice">{progress?.verified_total ?? verifiedTotal} / {target}</p>
        </div>
        <div className="border-2 border-court-ice/40 p-2">
          <p className="text-xs uppercase text-court-mute">Remaining</p>
          <p className="text-court-chart">{progress?.remaining_to_target ?? remaining}</p>
        </div>
        <div className="border-2 border-court-ice/40 p-2">
          <p className="text-xs uppercase text-court-mute">Ceiling</p>
          <p className="text-court-ice">{ceiling}</p>
        </div>
        <div className="border-2 border-court-ice/40 p-2">
          <p className="text-xs uppercase text-court-mute">Pending Queue</p>
          <p className="text-court-ice">{pendingCount}</p>
        </div>
      </div>

      {/* Campaign status badge */}
      {campaign && (
        <div className="mb-3 flex items-center gap-2">
          <span className="font-mono text-xs uppercase text-court-mute">Status:</span>
          <span className={cn("font-display uppercase text-sm", CAMPAIGN_STATUS_COLORS[campaign.status] || "text-court-mute")}>
            {CAMPAIGN_STATUS_LABELS[campaign.status] || campaign.status}
          </span>
          {campaign.stop_reason && (
            <span className="font-mono text-xs text-court-mute">· {campaign.stop_reason}</span>
          )}
        </div>
      )}

      {/* Live progress */}
      {campaign && progress && (running || isActive || isTerminal) && (
        <div className="mb-4 border-2 border-court-chart/40 p-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-sm">
            <ProgressStat label="Wallets" value={completedProgress ? completedProgress.label : "0 of 0"} />
            <ProgressStat label="Campaign Calls" value={campaign.campaign_calls_used || 0} />
            <ProgressStat label="Succeeded" value={campaign.wallets_succeeded || 0} color="text-court-chart" />
            <ProgressStat label="Failed" value={campaign.wallets_failed || 0} color="text-court-red" />
            <ProgressStat label="Dismissed" value={campaign.wallets_dismissed || 0} />
            <ProgressStat label="Mistrial" value={campaign.wallets_mistrial || 0} />
            <ProgressStat label="Est. Remaining" value={progress.estimated_calls_remaining || 0} />
            <ProgressStat label="Verified Total" value={progress.verified_total ?? verifiedTotal} />
          </div>
          {campaign.current_address_short && running && (
            <div className="flex items-center gap-2 font-mono text-sm text-court-chart">
              <Loader2 className="h-3 w-3 animate-spin" />
              Processing: {campaign.current_address_short} on {campaign.current_network}
            </div>
          )}
        </div>
      )}

      {/* Interrupted campaign banner */}
      {interrupted && campaign && !running && (
        <div className="mb-4 border-2 border-yellow-400 bg-court-navy p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-yellow-400" />
            <div className="flex-1">
              <p className="font-mono text-sm text-yellow-400 mb-1">
                Campaign was interrupted by a page refresh.
              </p>
              <p className="font-mono text-xs text-court-mute">
                {completedProgress?.label || "0 of 0"} wallets completed · {campaign.campaign_calls_used || 0} calls used
              </p>
              <div className="flex gap-2 mt-2">
                <button type="button" onClick={handleResume}
                  className="inline-flex items-center gap-1 bg-court-chart text-court-navy font-mono text-xs uppercase px-3 py-1.5 border-2 border-court-navy hover:bg-court-ice transition-colors">
                  <Play className="h-3 w-3" /> Resume
                </button>
                <button type="button" onClick={handleStop}
                  className="inline-flex items-center gap-1 bg-court-red text-court-ice font-mono text-xs uppercase px-3 py-1.5 border-2 border-court-ice hover:opacity-80 transition-opacity">
                  <Square className="h-3 w-3" /> Stop
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Start controls (only when no active campaign) */}
      {!campaign && !loadingState && (
        <>
          <div className="grid sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="font-mono text-xs uppercase text-court-mute block mb-1">Max Wallets</label>
              <select value={maxWallets} onChange={(e) => setMaxWallets(e.target.value === "all" ? "all" : parseInt(e.target.value, 10))}
                disabled={running}
                className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-2 border-2 border-court-ice/40 focus:border-court-chart outline-none">
                {CAMPAIGN_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                <option value="all">All Approved ({pendingCount})</option>
              </select>
            </div>
            <div className="font-mono text-sm space-y-1">
              <p className="text-court-mute">Wallets to process: <span className="text-court-ice font-bold">{walletsToProcess}</span></p>
              <p className="text-court-mute">Est. physical calls: <span className="text-court-chart font-bold">~{estimatedCalls}</span></p>
              <p className="text-court-mute">Pending queue: <span className="text-court-ice">{pendingCount}</span></p>
            </div>
          </div>

          <label className="flex items-start gap-2 mb-3 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={running}
              className="mt-0.5" />
            <span className="font-mono text-sm text-court-ice">
              I understand this campaign makes real Nansen API requests and creates real Wallet Court cases for each wallet.
            </span>
          </label>

          <button type="button" onClick={handleStart} disabled={!confirmed || running || pendingCount === 0 || remaining <= 0}
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-mono text-sm uppercase tracking-[0.1em] px-4 py-2 border-2 border-court-navy hover:bg-court-ice transition-colors disabled:opacity-50">
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Start Campaign
          </button>
        </>
      )}

      {/* Running controls */}
      {running && campaign && (
        <div className="flex gap-3">
          <button type="button" onClick={handlePause}
            className="inline-flex items-center gap-2 border-2 border-yellow-400 text-yellow-400 font-mono text-sm uppercase px-4 py-2 hover:bg-yellow-400 hover:text-court-navy transition-colors">
            <Pause className="h-4 w-4" /> Pause After Current
          </button>
          <button type="button" onClick={handleStop}
            className="inline-flex items-center gap-2 bg-court-red text-court-ice font-mono text-sm uppercase px-4 py-2 border-2 border-court-ice hover:opacity-80 transition-opacity">
            <Square className="h-4 w-4" /> Stop Campaign
          </button>
        </div>
      )}

      {/* Resume controls for paused campaign */}
      {campaign && campaign.status === "paused" && !running && !interrupted && (
        <div className="flex gap-3">
          <button type="button" onClick={handleResume}
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-mono text-sm uppercase px-4 py-2 border-2 border-court-navy hover:bg-court-ice transition-colors">
            <Play className="h-4 w-4" /> Resume Campaign
          </button>
          <button type="button" onClick={handleStop}
            className="inline-flex items-center gap-2 bg-court-red text-court-ice font-mono text-sm uppercase px-4 py-2 border-2 border-court-ice hover:opacity-80 transition-opacity">
            <Square className="h-4 w-4" /> Stop Campaign
          </button>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-court-red" />
          <span className="font-mono text-sm text-court-red">{error}</span>
        </div>
      )}

      {/* Campaign results */}
      {results.length > 0 && !running && (
        <div className="mt-4 border-2 border-court-ice/40 p-3">
          <p className="font-display uppercase text-court-chart text-sm mb-2">Campaign Results</p>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className="flex items-center justify-between font-mono text-xs border-b border-court-ice/10 pb-1">
                <div className="flex items-center gap-2">
                  <span className="text-court-ice">{r.item?.address_short}</span>
                  <span className="text-court-mute">{r.item?.network}</span>
                </div>
                <div className="flex items-center gap-3">
                  {r.verdict_name && <span className="text-court-chart">{r.verdict_name}</span>}
                  {r.case_outcome && !r.verdict_name && <span className="text-court-mute">{r.case_outcome}</span>}
                  {r.status === "failed" && <span className="text-court-red">Failed</span>}
                  {r.physical_calls_used != null && <span className="text-court-mute">{r.physical_calls_used} calls</span>}
                  {r.case_slug && (
                    <Link to={`/case/${r.case_slug}`} className="inline-flex items-center gap-1 text-court-chart hover:text-court-ice">
                      View <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Clear campaign button for terminal campaigns */}
      {isTerminal && !running && (
        <button type="button" onClick={() => { setCampaign(null); setProgress(null); setResults([]); setError(""); }}
          className="mt-3 font-mono text-xs text-court-mute hover:text-court-ice underline">
          Clear campaign display
        </button>
      )}
    </div>
  );
}

function ProgressStat({ label, value, color = "text-court-ice" }) {
  return (
    <div>
      <span className="text-court-mute text-xs">{label}: </span>
      <span className={cn("font-bold", color)}>{value}</span>
    </div>
  );
}