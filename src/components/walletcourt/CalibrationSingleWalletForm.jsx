import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, FileCheck, Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { validateWalletForChain, NETWORKS } from "@/lib/walletValidation";

// Single-wallet import form: the default import experience. Validates the
// wallet against the selected network before queueing, shows field-level
// errors, clears the form after success, and shows the sanitized queued item.
export default function CalibrationSingleWalletForm({ onImported }) {
  const [network, setNetwork] = useState("ethereum");
  const [walletAddress, setWalletAddress] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [testObjective, setTestObjective] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});

  function validateFields() {
    const errs = {};
    if (!network) errs.network = "Select a network.";
    if (!walletAddress.trim()) errs.walletAddress = "Wallet address is required.";
    if (!sourceLabel.trim()) errs.sourceLabel = "Source label is required.";
    if (!testObjective.trim()) errs.testObjective = "Test objective is required.";
    if (walletAddress.trim() && network) {
      const v = validateWalletForChain(network, walletAddress);
      if (!v.ok) errs.walletAddress = v.message;
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function buildCsvLine() {
    // Escape fields that might contain commas
    const esc = (s) => s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    return [network, walletAddress.trim(), sourceLabel.trim(), testObjective.trim()].map(esc).join(",");
  }

  async function handleDryRun() {
    setError("");
    setResult(null);
    if (!validateFields()) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("importCalibrationDocket", {
        text: buildCsvLine(),
        dry_run: true
      });
      setResult(res?.data);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Dry run failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove() {
    setError("");
    setResult(null);
    if (!validateFields()) return;
    setLoading(true);
    try {
      const res = await base44.functions.invoke("importCalibrationDocket", {
        text: buildCsvLine(),
        dry_run: false
      });
      setResult(res?.data);
      if (res?.data?.queued > 0) {
        // Clear the form after successful queue
        setWalletAddress("");
        setSourceLabel("");
        setTestObjective("");
        setFieldErrors({});
        if (onImported) onImported();
      }
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="border-2 border-court-ice bg-court-navy p-5">
      <h3 className="font-display uppercase text-court-ice text-xl mb-3">Add Wallet</h3>

      <div className="space-y-3">
        <div>
          <label className="font-mono text-xs uppercase text-court-mute block mb-1">Network</label>
          <select
            value={network}
            onChange={(e) => { setNetwork(e.target.value); setFieldErrors((f) => ({ ...f, network: undefined })); }}
            disabled={loading}
            className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-2 border-2 border-court-ice/40 focus:border-court-chart outline-none"
          >
            <option value="ethereum">Ethereum</option>
            <option value="base">Base</option>
            <option value="solana">Solana</option>
          </select>
          {fieldErrors.network && <p className="font-mono text-xs text-court-red mt-1">{fieldErrors.network}</p>}
        </div>

        <div>
          <label className="font-mono text-xs uppercase text-court-mute block mb-1">Wallet Address</label>
          <input
            type="text"
            value={walletAddress}
            onChange={(e) => { setWalletAddress(e.target.value); setFieldErrors((f) => ({ ...f, walletAddress: undefined })); }}
            disabled={loading}
            placeholder="0x... or Solana address"
            className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-2 border-2 border-court-ice/40 focus:border-court-chart outline-none"
          />
          {fieldErrors.walletAddress && <p className="font-mono text-xs text-court-red mt-1">{fieldErrors.walletAddress}</p>}
        </div>

        <div>
          <label className="font-mono text-xs uppercase text-court-mute block mb-1">Source Label</label>
          <input
            type="text"
            value={sourceLabel}
            onChange={(e) => { setSourceLabel(e.target.value); setFieldErrors((f) => ({ ...f, sourceLabel: undefined })); }}
            disabled={loading}
            placeholder="e.g. public wallet research"
            className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-2 border-2 border-court-ice/40 focus:border-court-chart outline-none"
          />
          {fieldErrors.sourceLabel && <p className="font-mono text-xs text-court-red mt-1">{fieldErrors.sourceLabel}</p>}
        </div>

        <div>
          <label className="font-mono text-xs uppercase text-court-mute block mb-1">Test Objective</label>
          <input
            type="text"
            value={testObjective}
            onChange={(e) => { setTestObjective(e.target.value); setFieldErrors((f) => ({ ...f, testObjective: undefined })); }}
            disabled={loading}
            placeholder="e.g. cross-chain verdict calibration"
            className="w-full bg-[#080B1C] text-court-ice font-mono text-sm p-2 border-2 border-court-ice/40 focus:border-court-chart outline-none"
          />
          {fieldErrors.testObjective && <p className="font-mono text-xs text-court-red mt-1">{fieldErrors.testObjective}</p>}
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={handleDryRun}
          disabled={loading}
          className="inline-flex items-center gap-2 border-2 border-court-ice text-court-ice font-mono text-sm uppercase tracking-[0.1em] px-4 py-2 hover:bg-court-uv transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck className="h-4 w-4" />}
          Dry Run
        </button>
        <button
          type="button"
          onClick={handleApprove}
          disabled={loading}
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
          <p className="font-display uppercase text-court-chart text-sm mb-2 flex items-center gap-1.5">
            {result.dry_run ? <FileCheck className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {result.dry_run ? "Dry Run Result" : `Queued ${result.queued || 0} item${result.queued === 1 ? "" : "s"}`}
          </p>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm">
            <Count label="Total" value={result.preflight.counts.total} />
            <Count label="Accepted" value={result.preflight.counts.accepted} color="text-court-chart" />
            <Count label="Invalid" value={result.preflight.counts.invalid} color="text-court-red" />
            <Count label="Duplicate" value={result.preflight.counts.duplicate_in_file} />
            <Count label="Already queued" value={result.preflight.counts.already_queued} />
            <Count label="Already tried" value={result.preflight.counts.already_tried} />
          </div>
          {result.preflight.invalid.length > 0 && (
            <div className="mt-3">
              <p className="font-mono text-xs uppercase text-court-red mb-1">Invalid entries:</p>
              {result.preflight.invalid.map((r, i) => (
                <p key={i} className="font-mono text-xs text-court-mute">
                  Line {r.line}: {r.address_short} — {r.reason}
                </p>
              ))}
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