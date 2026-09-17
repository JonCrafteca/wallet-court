import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Megaphone, RefreshCw, Copy, Check, Share2, X, Twitter } from "lucide-react";
import { cn } from "@/lib/utils";
import { base44 } from "@/api/base44Client";
import {
  buildDraft,
  buildCaseUrl,
  xIntentUrl,
  overXLimit,
} from "@/lib/courtDispatch";
import { SHOUTIT_X_HANDLE, SHOUTIT_DOMAIN, X_CHAR_LIMIT, MAX_POST_TEXT } from "@/lib/shareConfig";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";
import VerdictCardPreview from "./VerdictCardPreview";

const STYLES = [
  { id: "court_dispatch", label: "Court Dispatch" },
  { id: "self_roast", label: "Self-Roast" },
  { id: "challenge_post", label: "Challenge Post" },
];

const TARGETS = [
  { id: "x", label: "Post to My X" },
  { id: "shoutit", label: "Submit to ShoutIt Feed" },
  { id: "both", label: "Both" },
];

export default function ShoutModal({ trial, open, onOpenChange }) {
  const [style, setStyle] = useState("court_dispatch");
  const [variationBase, setVariationBase] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [text, setText] = useState("");
  const [xHandle, setXHandle] = useState("");
  const [target, setTarget] = useState("x");
  const [approved, setApproved] = useState(false);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const caseUrl = useMemo(() => buildCaseUrl(trial.public_slug), [trial.public_slug]);
  const hasNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const drafts = useMemo(
    () => [0, 1, 2].map((offset) => buildDraft(trial, style, { xHandle, caseUrl }, variationBase + offset)),
    [trial, style, xHandle, caseUrl, variationBase]
  );

  // Reset selection + text when drafts change (style/handle/regenerate).
  useEffect(() => {
    setText(drafts[selectedIndex] || drafts[0] || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts]);

  // Track open + reset transient state each time the modal opens.
  useEffect(() => {
    if (open) {
      trackShare(SHARE_EVENTS.SHOUT_MODAL_OPENED, { verdict_code: trial.verdict_code, data_mode: trial.data_mode });
      setMessage("");
      setApproved(false);
      setConsent(false);
    }
  }, [open, trial.verdict_code, trial.data_mode]);

  function selectDraft(i) {
    setSelectedIndex(i);
    setText(drafts[i]);
  }

  function regenerate() {
    setVariationBase((v) => v + 3);
    setSelectedIndex(0);
  }

  function removeHandle() {
    setXHandle("");
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      trackShare(SHARE_EVENTS.POST_TEXT_COPIED);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setMessage("Could not copy to clipboard.");
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: "Wallet Court Verdict", text, url: caseUrl });
      trackShare(SHARE_EVENTS.NATIVE_SHARE_INVOKED);
    } catch {
      // user cancelled or unsupported — no false "shared" message
    }
  }

  async function publish() {
    setMessage("");
    if (!approved) {
      setMessage("Approve the final text before publishing.");
      return;
    }
    if (!text.trim()) {
      setMessage("Post text cannot be empty.");
      return;
    }
    const wantsShoutIt = target === "shoutit" || target === "both";
    const wantsX = target === "x" || target === "both";

    if (wantsShoutIt && !consent) {
      setMessage("Consent to publish is required for ShoutIt submission.");
      return;
    }

    if (wantsX) {
      trackShare(SHARE_EVENTS.X_COMPOSER_OPENED);
      window.open(xIntentUrl(text), "_blank", "noopener,noreferrer");
      setMessage("X will open so you can review and publish the final post.");
    }

    if (wantsShoutIt) {
      setSubmitting(true);
      try {
        const res = await base44.functions.invoke("submitCourtDispatch", {
          case_slug: trial.public_slug,
          submission_type: style,
          approved_post_text: text,
          optional_x_handle: xHandle,
          consent_to_publish: consent,
        });
        if (res?.data?.error) {
          setMessage((m) => (m ? `${m} ` : "") + res.data.error);
        } else {
          trackShare(SHARE_EVENTS.SHOUTIT_SUBMISSION_CREATED, { submission_type: style, data_mode: trial.data_mode });
          setMessage((m) =>
            (m ? `${m} ` : "") + "Submitted to the ShoutIt court desk for editorial selection."
          );
        }
      } catch (e) {
        setMessage((m) => (m ? `${m} ` : "") + (e?.message || "Submission failed."));
      } finally {
        setSubmitting(false);
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-court-navy text-court-ice border-2 border-court-ice max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-[0.06em] text-court-ice text-2xl">
            Shout This Verdict
          </DialogTitle>
          <DialogDescription className="font-mono text-sm text-court-mute">
            Wallet Court · A ShoutIt Original —{" "}
            {trial.data_mode === "live" ? "Evidence powered by Nansen" : "Demo case"}
          </DialogDescription>
        </DialogHeader>

        {/* Style selector */}
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">Post Style</p>
          <div className="grid grid-cols-3 gap-2">
            {STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setStyle(s.id); setSelectedIndex(0); setVariationBase(0); }}
                className={cn(
                  "font-display uppercase tracking-[0.06em] text-sm py-2.5 border-2 transition-colors",
                  style === s.id
                    ? "bg-court-chart text-court-navy border-court-chart"
                    : "bg-court-navy text-court-ice border-court-ice hover:bg-court-uv"
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Draft options */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute">Draft Options</p>
            <button
              type="button"
              onClick={regenerate}
              className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.12em] text-court-chart hover:text-court-ice"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </button>
          </div>
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <button
                key={i}
                type="button"
                onClick={() => selectDraft(i)}
                className={cn(
                  "block w-full text-left border-2 p-3 font-mono text-sm leading-relaxed whitespace-pre-wrap break-words transition-colors",
                  selectedIndex === i
                    ? "border-court-chart bg-court-uv text-court-ice"
                    : "border-court-ice bg-court-navy text-court-mute hover:border-court-chart"
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Editable text */}
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">Your Post</p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_POST_TEXT))}
            rows={6}
            className="w-full border-2 border-court-ice bg-court-navy p-3 font-mono text-sm text-court-ice leading-relaxed focus:border-court-chart focus:outline-none resize-y"
            aria-label="Editable post text"
          />
          <div className="mt-1 flex items-center justify-between font-mono text-xs">
            <span className="text-court-mute">Max {MAX_POST_TEXT} chars</span>
            <span className={cn(overXLimit(text) ? "text-court-red" : "text-court-mute")}>
              {text.length} / {X_CHAR_LIMIT} (X limit)
            </span>
          </div>
        </div>

        {/* X handle */}
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">Optional X Handle</p>
          <div className="flex items-center gap-2">
            <div className="flex items-center border-2 border-court-ice bg-court-navy focus-within:border-court-chart">
              <span className="px-2 text-court-chart font-mono text-base">@</span>
              <input
                type="text"
                value={xHandle}
                onChange={(e) => setXHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15))}
                placeholder="yourhandle"
                className="bg-transparent py-2 pr-2 font-mono text-sm text-court-ice placeholder:text-court-mute focus:outline-none w-40"
                aria-label="Optional X handle"
              />
            </div>
            {xHandle && (
              <button
                type="button"
                onClick={removeHandle}
                className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-[0.12em] text-court-red hover:text-court-ice"
              >
                <X className="h-3.5 w-3.5" /> Remove tag
              </button>
            )}
          </div>
        </div>

        {/* Verdict card preview */}
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">Attached Verdict Card</p>
          <VerdictCardPreview trial={trial} className="w-full border-2 border-court-ice" />
        </div>

        {/* Publication target */}
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">Publish To</p>
          <div className="grid grid-cols-3 gap-2">
            {TARGETS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTarget(t.id)}
                className={cn(
                  "font-mono text-xs uppercase tracking-[0.1em] py-2.5 border-2 transition-colors",
                  target === t.id
                    ? "bg-court-chart text-court-navy border-court-chart"
                    : "bg-court-navy text-court-ice border-court-ice hover:bg-court-uv"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Approvals */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="mt-1 h-4 w-4 accent-court-chart" />
          <span className="font-mono text-sm text-court-ice leading-relaxed">I approve this final text.</span>
        </label>
        {(target === "shoutit" || target === "both") && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-court-chart" />
            <span className="font-mono text-sm text-court-ice leading-relaxed">
              I authorize ShoutIt to publish this Wallet Court verdict, case link, approved post text, verdict card, and optional X handle.
            </span>
          </label>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={publish}
            disabled={submitting}
            className="flex-1 inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-60"
          >
            <Megaphone className="h-5 w-5" /> Shout It
          </button>
          {hasNativeShare && (
            <button
              type="button"
              onClick={nativeShare}
              className="inline-flex items-center justify-center gap-2 bg-court-uv text-court-ice font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-ice hover:brightness-110 transition-all"
              aria-label="Share via device"
            >
              <Share2 className="h-5 w-5" /> Share
            </button>
          )}
          <button
            type="button"
            onClick={copyText}
            className="inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-ice hover:bg-court-uv transition-colors"
            aria-label="Copy post text"
          >
            {copied ? <Check className="h-5 w-5 text-court-chart" /> : <Copy className="h-5 w-5" />}
            {copied ? "Copied" : "Copy Text"}
          </button>
        </div>

        {message && (
          <p className="font-mono text-sm text-court-chart leading-relaxed break-words">{message}</p>
        )}

        <p className="font-mono text-xs text-court-mute leading-relaxed">
          Opening X or your share sheet only opens the composer — it never publishes for you. ShoutIt submissions are reviewed by the court desk and are not guaranteed publication.
        </p>
      </DialogContent>
    </Dialog>
  );
}