import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Upload, FileCheck, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

// Bulk CSV import form: paste CSV, dry-run preflight, approve and queue.
// Collapsed by default behind an advanced section toggle.
export default function CalibrationImportForm({ onImported }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  async function handleDryRun() {
    if (!text.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await base44.functions.invoke("importCalibrationDocket", { text, dry_run: true });
      setResult(res?.data);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Dry run failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    if (!text.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await base44.functions.invoke("importCalibrationDocket", { text, dry_run: false });
      setResult(res?.data);
      if (onImported) onImported();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-2 border-court-ice/40 bg-court-navy p-5">
      <button type="button" onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full">
        <h3 className="font-display uppercase text-court-ice text-xl">Bulk Import CSV</h3>
        {open ? <ChevronUp className="h-5 w-5 text-court-mute" /> : <ChevronDown className="h-5 w-5 text-court-mute" />}
      </button>

      {open && (
        <div className="mt-3">
          <p className="font-mono text-sm text-court-mute mb-2">
            CSV format (one wallet per line):
          </p>
          <p className="font-mono text-xs text-court-chart mb-3">
            network,wallet_address,source_label,test_objective
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"network,wallet_address,source_label,test_objective\nsolana,7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU,public wallet research,cross-chain verdict calibration\nethereum,0x1234567890abcdef1234567890abcdef12345678,public wallet research,cross-chain verdict calibration\nbase,0xabcdef1234567890abcdef1234567890abcdef12,public wallet research,cross-chain verdict calibration"}
            className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-3 border-2 border-court-ice/40 focus:border-court-chart outline-none resize-y"
          />

          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={handleDryRun}
              disabled={loading || !text.trim()}
              className="inline-flex items-center gap-2 border-2 border-court-ice text-court-ice font-mono text-sm uppercase tracking-[0.1em] px-4 py-2 hover:bg-court-uv transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
              Dry Run
            </button>
            <button
              type="button"
              onClick={handleApprove}
              disabled={loading || !text.trim()}
              className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-mono text-sm uppercase tracking-[0.1em] px-4 py-2 border-2 border-court-navy hover:bg-court-ice transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Approve &amp; Queue
            </button>
          </div>

          {error && (
            <div className="mt-3 flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-court-red" />
              <span className="font-mono text-sm text-court-red">{error}</span>
            </div>
          )}

          {result?.preflight && (
            <div className="mt-4 border-2 border-court-mute/40 p-4">
              <p className="font-display uppercase text-court-chart text-sm mb-2">
                {result.dry_run ? "Dry Run Result" : `Queued ${result.queued || 0} items`}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-sm">
                <Count label="Total" value={result.preflight.counts.total} />
                <Count label="Accepted" value={result.preflight.counts.accepted} color="text-court-chart" />
                <Count label="Invalid" value={result.preflight.counts.invalid} color="text-court-red" />
                <Count label="Duplicate in file" value={result.preflight.counts.duplicate_in_file} />
                <Count label="Already queued" value={result.preflight.counts.already_queued} />
                <Count label="Already tried" value={result.preflight.counts.already_tried} />
              </div>
              {result.preflight.invalid.length > 0 && (
                <div className="mt-3">
                  <p className="font-mono text-xs uppercase text-court-red mb-1">Invalid entries:</p>
                  {result.preflight.invalid.slice(0, 5).map((r, i) => (
                    <p key={i} className="font-mono text-xs text-court-mute">
                      Line {r.line}: {r.address_short} — {r.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Count({ label, value, color = "text-court-ice" }) {
  return (
    <div>
      <span className="text-court-mute">{label}: </span>
      <span className={cn("font-bold", color)}>{value}</span>
    </div>
  );
}