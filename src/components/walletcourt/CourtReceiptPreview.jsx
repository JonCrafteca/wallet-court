import { useEffect, useRef, useState } from "react";
import { Download, Share2, Loader2, Image as ImageIcon, AlertTriangle, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  drawCourtReceipt,
  downloadCourtReceipt,
  getCourtReceiptBlob,
  canShareFiles,
  isMobileDevice,
  RECEIPT_SIZES,
} from "@/lib/courtReceipt";
import { buildCaseUrl, xIntentUrl } from "@/lib/courtDispatch";
import { buildVerdictSharePost, truncateForX } from "@/lib/summonsHelpers";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";
import { X_CHAR_LIMIT } from "@/lib/shareConfig";

export default function CourtReceiptPreview({ trial }) {
  const canvasRef = useRef(null);
  const [orientation, setOrientation] = useState("landscape");
  const [rendering, setRendering] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState("");
  const [shareNotice, setShareNotice] = useState("");
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [pendingXUrl, setPendingXUrl] = useState(null);

  const caseUrl = buildCaseUrl(trial.public_slug);
  const size = RECEIPT_SIZES[orientation];

  useEffect(() => {
    let alive = true;
    (async () => {
      setRendering(true);
      setError("");
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = size.w;
        canvas.height = size.h;
        await drawCourtReceipt(canvas, trial, orientation);
      } catch {
        if (alive) setError("Could not render the receipt preview. Try again.");
      } finally {
        if (alive) setRendering(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trial.public_slug, orientation, trial.verdict_code, trial.severity_score]);

  async function handleDownloadLandscape() {
    setDownloading(true);
    setError("");
    try {
      await downloadCourtReceipt(trial, "landscape");
      trackShare(SHARE_EVENTS.COURT_RECEIPT_DOWNLOADED, { orientation: "landscape" });
    } catch {
      setError("Could not download the receipt. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadPortrait() {
    setDownloading(true);
    setError("");
    try {
      await downloadCourtReceipt(trial, "portrait");
      trackShare(SHARE_EVENTS.COURT_RECEIPT_DOWNLOADED, { orientation: "portrait" });
    } catch {
      setError("Could not download the receipt. Try again.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleShareToX() {
    setSharing(true);
    setError("");
    setShareNotice("");
    setPopupBlocked(false);
    setPendingXUrl(null);

    const postText = buildVerdictSharePost(trial.verdict_name, trial.severity_score, caseUrl);
    const truncated = truncateForX(postText, X_CHAR_LIMIT);
    const xUrl = xIntentUrl(truncated);

    // Desktop browsers: ALWAYS use download + X Web Intent, even if
    // navigator.share exists (macOS Chrome/Safari have it but open a generic
    // share sheet without X). Open X synchronously from the user click
    // BEFORE any async operation so popup blockers don't block it.
    if (!isMobileDevice()) {
      // Open X FIRST (synchronous from click — avoids popup blocker)
      const xWin = window.open(xUrl, "_blank", "noopener,noreferrer");

      try {
        await downloadCourtReceipt(trial, orientation);
        trackShare(SHARE_EVENTS.COURT_RECEIPT_DOWNLOADED, { orientation });
        trackShare(SHARE_EVENTS.COURT_RECEIPT_SHARED, { method: "x_intent" });

        if (!xWin || xWin.closed) {
          // Popup was blocked — show fallback link, keep downloaded receipt
          setPopupBlocked(true);
          setPendingXUrl(xUrl);
          setShareNotice("Receipt downloaded. X was blocked by your browser — click below to open the composer.");
        } else {
          setShareNotice("Receipt downloaded. X opened—attach the downloaded receipt and post.");
        }
      } catch {
        setError("Could not download the receipt. Try again.");
      } finally {
        setSharing(false);
      }
      return;
    }

    // Mobile browsers: use Web Share with the PNG file only when genuinely
    // mobile/touch + navigator.share + navigator.canShare({ files }).
    try {
      const blob = await getCourtReceiptBlob(trial, orientation);
      const file = new File(
        [blob],
        `wallet-court-receipt-${trial.public_slug}-${orientation}.png`,
        { type: "image/png" }
      );

      // Verify file sharing is actually supported before calling share
      if (canShareFiles() && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: "Wallet Court Verdict",
          text: truncated,
          url: caseUrl,
          files: [file],
        });
        trackShare(SHARE_EVENTS.COURT_RECEIPT_SHARED, { method: "web_share" });
        setShareNotice("Share sheet opened.");
      } else {
        // File sharing not actually supported — fallback to download + X
        await downloadCourtReceipt(trial, orientation);
        trackShare(SHARE_EVENTS.COURT_RECEIPT_DOWNLOADED, { orientation });
        window.open(xUrl, "_blank", "noopener,noreferrer");
        trackShare(SHARE_EVENTS.COURT_RECEIPT_SHARED, { method: "x_intent" });
        setShareNotice("Receipt downloaded. X opened—attach the downloaded receipt and post.");
      }
    } catch (e) {
      if (e?.name === "AbortError") {
        // User cancelled — not an error, no alarming message
        setShareNotice("");
      } else {
        // Other error (rejected, timeout, unsupported) — fallback
        try {
          await downloadCourtReceipt(trial, orientation);
          trackShare(SHARE_EVENTS.COURT_RECEIPT_DOWNLOADED, { orientation });
          window.open(xUrl, "_blank", "noopener,noreferrer");
          trackShare(SHARE_EVENTS.COURT_RECEIPT_SHARED, { method: "x_intent" });
          setShareNotice("Receipt downloaded. X opened—attach the downloaded receipt and post.");
        } catch {
          setError("Could not share the receipt. Try downloading instead.");
        }
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5">
      <div className="flex items-start gap-3 mb-4">
        <ImageIcon className="h-6 w-6 text-court-chart shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-display uppercase tracking-[0.06em] text-court-ice text-lg">Court Receipt</p>
          <p className="font-mono text-sm text-court-mute leading-relaxed mt-1">
            Download an official court receipt and share it on X.
          </p>
        </div>
      </div>

      {/* Orientation toggle */}
      <div className="flex gap-2 mb-4">
        {Object.entries(RECEIPT_SIZES).map(([key, val]) => (
          <button
            key={key}
            type="button"
            onClick={() => setOrientation(key)}
            aria-pressed={orientation === key}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 font-display uppercase tracking-[0.06em] text-sm px-3 py-2.5 border-2 transition-colors",
              orientation === key
                ? "bg-court-chart text-court-navy border-court-chart"
                : "bg-court-navy text-court-ice border-court-ice hover:bg-court-uv"
            )}
          >
            {val.label}
          </button>
        ))}
      </div>

      {/* Preview canvas */}
      <div className="border-2 border-court-ice bg-court-navy overflow-hidden mb-4">
        <div className="relative">
          {rendering && (
            <div className="absolute inset-0 flex items-center justify-center bg-court-navy/80 z-10">
              <Loader2 className="h-6 w-6 animate-spin text-court-chart" />
            </div>
          )}
          <canvas
            ref={canvasRef}
            className="w-full h-auto block"
            aria-label={`Court receipt preview (${size.label})`}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 border-2 border-court-red bg-court-navy p-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-court-red shrink-0 mt-0.5" />
          <p className="font-mono text-sm text-court-red leading-relaxed">{error}</p>
        </div>
      )}

      {/* Share notice */}
      {shareNotice && (
        <div className="mb-3 border-2 border-court-chart bg-court-uv p-3">
          <p className="font-mono text-sm text-court-ice leading-relaxed">{shareNotice}</p>
        </div>
      )}

      {/* Popup blocked fallback */}
      {popupBlocked && pendingXUrl && (
        <div className="mb-3 border-2 border-court-chart bg-court-navy p-3">
          <p className="font-mono text-sm text-court-ice leading-relaxed mb-2">
            Your browser blocked the X composer popup.
          </p>
          <a
            href={pendingXUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2 border-2 border-court-navy hover:brightness-105 transition-all"
          >
            <ExternalLink className="h-4 w-4" /> Open X Composer
          </a>
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={handleShareToX}
          disabled={sharing || downloading}
          className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-60"
        >
          {sharing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Share2 className="h-5 w-5 text-court-navy" />}
          {sharing ? "Sharing…" : "Share to X"}
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleDownloadLandscape}
            disabled={downloading}
            className="inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.06em] text-sm px-3 py-2.5 border-2 border-court-ice hover:bg-court-uv transition-colors disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> X Landscape
          </button>
          <button
            type="button"
            onClick={handleDownloadPortrait}
            disabled={downloading}
            className="inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.06em] text-sm px-3 py-2.5 border-2 border-court-ice hover:bg-court-uv transition-colors disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> Portrait
          </button>
        </div>
      </div>
    </div>
  );
}