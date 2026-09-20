import { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Play, Square, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Batch execution controls: size selector, confirmation checkbox, start batch,
// sequential wallet processing with live progress.
export default function CalibrationBatchControls({ verifiedTotal, target, ceiling, pendingCount, onBatchComplete }) {
  const [batchSize, setBatchSize] = useState(5);
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const stopRef = useRef(false);

  async function handleStartBatch() {
    if (!confirmed) return;
    setRunning(true);
    setError("");
    setProgress(null);
    stopRef.current = false;

    try {
      const claimRes = await base44.functions.invoke("startCalibrationBatch", {
        batch_size: batchSize,
        confirmed: true
      });
      if (claimRes?.data?.error) {
        setError(claimRes.data.error);
        setRunning(false);
        return;
      }
      const claimed = claimRes?.data?.claimed || [];
      const runId = claimRes?.data?.run_id;
      if (claimed.length === 0) {
        setError("No items claimed.");
        setRunning(false);
        return;
      }

      setProgress({ done: 0, total: claimed.length, current: claimed[0], results: [] });
      const results = [];

      for (let i = 0; i < claimed.length; i++) {
        if (stopRef.current) break;
        const item = claimed[i];
        setProgress((p) => ({ ...p, current: item, done: i }));
        const delayMs = i === 0 ? 0 : 2000;
        try {
          const res = await base44.functions.invoke("processCalibrationWallet", {
            docket_item_id: item.docket_item_id,
            run_id: runId,
            delay_ms: delayMs
          });
          const data = res?.data || {};
          results.push({ item, status: data.status, data });
          setProgress((p) => ({ ...p, done: i + 1, results: [...results] }));
          if (data.stop_batch) {
            setError(data.stop_reason || "Batch stopped.");
            break;
          }
        } catch (e) {
          results.push({ item, status: "error", error: e?.message || "Processing failed." });
          setProgress((p) => ({ ...p, done: i + 1, results: [...results] }));
          break;
        }
      }

      if (onBatchComplete) onBatchComplete();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Batch failed.");
    } finally {
      setRunning(false);
    }
  }

  function handleStop() {
    stopRef.current = true;
  }

  const remaining = Math.max(0, target - verifiedTotal);
  const avgPerCase = 4;
  const estimatedCalls = batchSize * avgPerCase;

  return (
    <div className="border-2 border-court-ice bg-court-navy p-5">
      <h3 className="font-display uppercase text-court-ice text-xl mb-3">Start Next Batch</h3>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="font-mono text-xs uppercase text-court-mute block mb-1">Batch size (1–5)</label>
          <select
            value={batchSize}
            onChange={(e) => setBatchSize(parseInt(e.target.value, 10))}
            disabled={running}
            className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-2 border-2 border-court-ice/40 focus:border-court-chart outline-none"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="font-mono text-sm space-y-1">
          <p className="text-court-mute">Verified: <span className="text-court-ice font-bold">{verifiedTotal} / {target}</span></p>
          <p className="text-court-mute">Remaining: <span className="text-court-chart">{remaining}</span></p>
          <p className="text-court-mute">Pending queue: <span className="text-court-ice">{pendingCount}</span></p>
          <p className="text-court-mute">Est. calls: <span className="text-court-ice">~{estimatedCalls}</span></p>
        </div>
      </div>

      {progress?.current && (
        <div className="mb-3 border-2 border-court-chart/40 p-3">
          <p className="font-mono text-sm text-court-chart">
            Processing {progress.done + 1} of {progress.total}: {progress.current.address_short} on {progress.current.network}
          </p>
          {progress.results.map((r, i) => (
            <p key={i} className={cn("font-mono text-xs mt-1", r.status === "completed" ? "text-court-chart" : r.status === "failed" ? "text-court-red" : "text-court-mute")}>
              {r.item.address_short}: {r.status}
              {r.data?.verdict_name ? ` → ${r.data.verdict_name}` : ""}
              {r.data?.physical_calls_used != null ? ` (${r.data.physical_calls_used} calls)` : ""}
            </p>
          ))}
        </div>
      )}

      <label className="flex items-start gap-2 mb-3 cursor-pointer">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          disabled={running}
          className="mt-0.5"
        />
        <span className="font-mono text-sm text-court-ice">
          I understand this batch makes real Nansen API requests and creates real Wallet Court cases.
        </span>
      </label>

      <div className="flex gap-3">
        {!running ? (
          <button
            type="button"
            onClick={handleStartBatch}
            disabled={!confirmed || pendingCount === 0}
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-mono text-sm uppercase tracking-[0.1em] px-4 py-2 border-2 border-court-navy hover:bg-court-ice transition-colors disabled:opacity-50"
          >
            <Play className="h-4 w-4" /> Start Next Batch
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStop}
            className="inline-flex items-center gap-2 bg-court-red text-court-ice font-mono text-sm uppercase tracking-[0.1em] px-4 py-2 border-2 border-court-ice hover:opacity-80 transition-opacity"
          >
            <Square className="h-4 w-4" /> Stop After Current
          </button>
        )}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-court-red" />
          <span className="font-mono text-sm text-court-red">{error}</span>
        </div>
      )}
    </div>
  );
}