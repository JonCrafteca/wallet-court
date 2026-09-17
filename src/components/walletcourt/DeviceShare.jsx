import { useState } from "react";
import { Share2, X as XIcon, Copy, Check, Download } from "lucide-react";
import { xIntentUrl } from "@/lib/courtDispatch";
import { getVerdictCardBlob, downloadVerdictCard } from "@/lib/verdictCard";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";

// Progressive sharing: native share sheet when permitted, otherwise a compact
// Wallet Court share-options panel. Never silently does nothing, never claims a
// share happened when it did not, and never creates a ShoutIt Court Desk record.
export default function DeviceShare({ trial, text, caseUrl }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const [copiedText, setCopiedText] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const url = caseUrl;
  // Native share is typically blocked inside a cross-origin preview iframe.
  const inIframe = typeof window !== "undefined" && window.self !== window.top;
  const nativeAvailable =
    typeof navigator !== "undefined" && typeof navigator.share === "function" && !inIframe;
  const label = nativeAvailable ? "SHARE VIA DEVICE" : "SHARE OPTIONS";

  // The case URL already appears in the draft text; share it once via `url`.
  function shareTextWithoutUrl(t) {
    return t
      .split("\n")
      .filter((line) => !line.includes(url))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function tryNativeShare() {
    setStatus("");
    let file = null;
    let canShareFiles = false;
    try {
      if (typeof navigator !== "undefined" && typeof navigator.canShare === "function") {
        const blob = await getVerdictCardBlob(trial);
        file = new File([blob], `wallet-court-${trial.public_slug}.png`, { type: "image/png" });
        canShareFiles = navigator.canShare({ files: [file] });
      }
    } catch {
      canShareFiles = false;
      file = null;
    }

    const shareData = { title: "Wallet Court Verdict", text: shareTextWithoutUrl(text), url };
    if (canShareFiles && file) shareData.files = [file];

    try {
      await navigator.share(shareData);
      trackShare(SHARE_EVENTS.NATIVE_SHARE_INVOKED);
      setStatus("Share sheet opened.");
    } catch (e) {
      const name = e?.name || "";
      if (name === "AbortError") {
        setStatus(""); // user cancelled — not a failure or success
      } else {
        // NotAllowedError, SecurityError, TypeError, or unsupported → fallback
        setOpen(true);
        setStatus("Sharing isn't available in this preview. Choose another option.");
      }
    }
  }

  function onClick() {
    if (!nativeAvailable) {
      setOpen((o) => !o);
      setStatus("");
      return;
    }
    tryNativeShare();
  }

  async function openXComposer() {
    trackShare(SHARE_EVENTS.X_COMPOSER_OPENED);
    window.open(xIntentUrl(text), "_blank", "noopener,noreferrer");
    setStatus("X composer opened.");
  }

  async function copyPostText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(true);
      trackShare(SHARE_EVENTS.POST_TEXT_COPIED);
      setStatus("Post text copied.");
      setTimeout(() => setCopiedText(false), 1800);
    } catch {
      setStatus("Could not copy post text.");
    }
  }

  async function copyCaseLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      trackShare(SHARE_EVENTS.CASE_LINK_COPIED);
      setStatus("Case link copied.");
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      setStatus("Could not copy case link.");
    }
  }

  async function downloadCard() {
    setDownloading(true);
    try {
      await downloadVerdictCard(trial);
      trackShare(SHARE_EVENTS.VERDICT_CARD_DOWNLOADED, {
        verdict_code: trial.verdict_code,
        data_mode: trial.data_mode,
      });
      setStatus("Verdict card downloaded.");
    } catch {
      setStatus("Could not download verdict card.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onClick}
        className="w-full inline-flex items-center justify-center gap-2 bg-court-uv text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-2.5 border-2 border-court-ice hover:brightness-110 transition-all"
      >
        <Share2 className="h-4 w-4" /> {label}
      </button>

      {status && (
        <p className="font-mono text-sm text-court-chart leading-relaxed">{status}</p>
      )}

      {open && (
        <div className="border-2 border-court-ice bg-court-navy p-3 space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-chart">
            Wallet Court Share Options
          </p>
          <button
            type="button"
            onClick={openXComposer}
            className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.06em] text-sm px-3 py-2 border-2 border-court-navy hover:brightness-105 transition-all"
          >
            <XIcon className="h-4 w-4" /> Open X Composer
          </button>
          <button
            type="button"
            onClick={copyPostText}
            className="w-full inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.06em] text-sm px-3 py-2 border-2 border-court-ice hover:bg-court-uv transition-colors"
          >
            {copiedText ? <Check className="h-4 w-4 text-court-chart" /> : <Copy className="h-4 w-4" />}
            {copiedText ? "Copied" : "Copy Post Text"}
          </button>
          <button
            type="button"
            onClick={copyCaseLink}
            className="w-full inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.06em] text-sm px-3 py-2 border-2 border-court-ice hover:bg-court-uv transition-colors"
          >
            {copiedLink ? <Check className="h-4 w-4 text-court-chart" /> : <Copy className="h-4 w-4" />}
            {copiedLink ? "Copied" : "Copy Case Link"}
          </button>
          <button
            type="button"
            onClick={downloadCard}
            disabled={downloading}
            className="w-full inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.06em] text-sm px-3 py-2 border-2 border-court-ice hover:bg-court-uv transition-colors disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> Download Verdict Card
          </button>
        </div>
      )}
    </div>
  );
}