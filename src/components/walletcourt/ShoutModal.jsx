import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Megaphone, RefreshCw, Copy, Check, Share2, X, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { base44 } from "@/api/base44Client";
import { buildDraft, buildDrafts, buildCaseUrl, xIntentUrl, overXLimit } from "@/lib/courtDispatch";
import { X_CHAR_LIMIT, MAX_POST_TEXT } from "@/lib/shareConfig";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";
import VerdictCardPreview from "./VerdictCardPreview";

const STYLES = [
  { id: "court_dispatch", label: "Court Dispatch", desc: "A straight news-style report of the court's verdict." },
  { id: "self_roast", label: "Self-Roast", desc: "You take the stand and own the verdict yourself." },
  { id: "challenge_post", label: "Challenge Post", desc: "Call out other wallets to face the court." },
];

const DESTINATIONS = [
  { id: "x", label: "My X Account", desc: "Opens an X composer with your post filled in. Wallet Court never posts automatically." },
  { id: "shoutit", label: "ShoutIt Court Desk", desc: "Submits your approved post to a private editorial queue. It is not published automatically." },
  { id: "both", label: "Both", desc: "Submits to the Court Desk, then opens X so you can post from your account." },
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
  const [regenerating, setRegenerating] = useState(false);
  const [regenNotice, setRegenNotice] = useState("");
  const [editNotice, setEditNotice] = useState("");
  const [doneX, setDoneX] = useState(false);
  const [doneShout, setDoneShout] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [expandedDraft, setExpandedDraft] = useState(-1);

  const editorRef = useRef(null);
  const editorWrapRef = useRef(null);

  const caseUrl = useMemo(() => buildCaseUrl(trial.public_slug), [trial.public_slug]);
  const hasNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const drafts = useMemo(
    () => buildDrafts(trial, style, { xHandle, caseUrl }, variationBase),
    [trial, style, xHandle, caseUrl, variationBase]
  );

  // Reset + initialize editor with the first draft each time the modal opens.
  useEffect(() => {
    if (open) {
      trackShare(SHARE_EVENTS.SHOUT_MODAL_OPENED, { verdict_code: trial.verdict_code, data_mode: trial.data_mode });
      setStyle("court_dispatch");
      setVariationBase(0);
      setSelectedIndex(0);
      setXHandle("");
      setTarget("x");
      setApproved(false);
      setConsent(false);
      setMessage("");
      setRegenNotice("");
      setEditNotice("");
      setDoneX(false);
      setDoneShout(false);
      setCardOpen(false);
      setExpandedDraft(-1);
      setText(buildDraft(trial, "court_dispatch", { xHandle: "", caseUrl }, 0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trial.public_slug]);

  function selectDraft(i) {
    setSelectedIndex(i);
    setText(drafts[i]);
    setEditNotice("Draft selected — make it yours.");
    setTimeout(() => setEditNotice(""), 2500);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorWrapRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function regenerate() {
    if (regenerating) return;
    setRegenerating(true);
    setRegenNotice("Generating New Drafts…");
    setSelectedIndex(-1);
    setTimeout(() => {
      setVariationBase((v) => v + 3);
      setRegenerating(false);
      setRegenNotice("3 new drafts ready.");
      setTimeout(() => setRegenNotice(""), 2000);
    }, 450);
  }

  function chooseStyle(s) {
    setStyle(s);
    setVariationBase(0);
    setSelectedIndex(-1);
    setExpandedDraft(-1);
    // Editor text is intentionally preserved — manual edits are not overwritten.
  }

  function chooseTarget(t) {
    setTarget(t);
    setDoneX(false);
    setDoneShout(false);
    setMessage("");
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

  const wantsX = target === "x" || target === "both";
  const wantsShout = target === "shoutit" || target === "both";
  const completed = (!wantsX || doneX) && (!wantsShout || doneShout);
  const primaryLabel = submitting
    ? "SUBMITTING…"
    : target === "x" ? "OPEN X COMPOSER"
    : target === "shoutit" ? "SUBMIT TO COURT DESK"
    : "SUBMIT + OPEN X";

  // X enforces 280 chars. Court Desk-only posts may stay at the 500-char editor max.
  const xOverLimit = wantsX && overXLimit(text);
  const overBy = Math.max(0, text.length - X_CHAR_LIMIT);

  async function publish() {
    setMessage("");
    if (!text.trim()) { setMessage("Post text cannot be empty."); return; }
    if (wantsX && overXLimit(text)) { setMessage("This post is over X's 280-character limit. Shorten it to open X."); return; }
    if (wantsX && !approved) { setMessage("Confirm you've reviewed the post to open it in X."); return; }
    if (wantsShout && !consent) { setMessage("Consent is required to submit to the Court Desk."); return; }
    setSubmitting(true);

    // For "Both", open a blank window synchronously from the click so browsers
    // treat it as user-initiated, then navigate it after the Court Desk submit.
    let popup = null;
    if (wantsX && target === "both" && !doneX) {
      popup = window.open("", "_blank");
      if (popup) {
        popup.document.write("<title>Wallet Court</title>");
        popup.document.body.style.fontFamily = "monospace";
        popup.document.body.style.padding = "2rem";
        popup.document.body.textContent = "Preparing your Wallet Court post…";
      }
    }

    try {
      if (wantsShout && !doneShout) {
        const res = await base44.functions.invoke("submitCourtDispatch", {
          case_slug: trial.public_slug,
          submission_type: style,
          approved_post_text: text,
          optional_x_handle: xHandle,
          consent_to_publish: consent,
        });
        if (res?.data?.error) {
          if (popup) popup.close();
          setMessage(res.data.error);
          setSubmitting(false);
          return;
        }
        setDoneShout(true);
        trackShare(SHARE_EVENTS.SHOUTIT_SUBMISSION_CREATED, { submission_type: style, data_mode: trial.data_mode });
      }
      if (wantsX && !doneX) {
        trackShare(SHARE_EVENTS.X_COMPOSER_OPENED);
        const url = xIntentUrl(text);
        if (popup) {
          popup.location.href = url;
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        setDoneX(true);
      }
    } catch (e) {
      if (popup) popup.close();
      setMessage(e?.message || "Action failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-court-navy text-court-ice border-2 border-court-ice max-w-2xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4 border-b-2 border-court-ice">
          <DialogTitle className="font-display uppercase tracking-[0.06em] text-court-ice text-2xl">
            Shout This Verdict
          </DialogTitle>
          <DialogDescription className="font-mono text-sm text-court-mute">
            Wallet Court · A ShoutIt Original —{" "}
            {trial.data_mode === "live" ? "Evidence powered by Nansen" : "Demo case"}
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable steps */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Step 1 — Choose Your Voice */}
          <section>
            <p className="font-display uppercase tracking-[0.08em] text-court-chart text-sm mb-2">Step 1 — Choose Your Voice</p>
            <div className="grid grid-cols-3 gap-2">
              {STYLES.map((s) => (
                <button key={s.id} type="button" onClick={() => chooseStyle(s.id)}
                  className={cn("font-display uppercase tracking-[0.06em] text-sm py-2.5 px-2 border-2 transition-colors",
                    style === s.id ? "bg-court-chart text-court-navy border-court-chart" : "bg-court-navy text-court-ice border-court-ice hover:bg-court-uv")}>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="mt-2 font-mono text-sm text-court-ice leading-relaxed">
              {STYLES.find((s) => s.id === style)?.desc}
            </p>
          </section>

          {/* Step 2 — Pick a Draft */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <p className="font-display uppercase tracking-[0.08em] text-court-chart text-sm">Step 2 — Pick a Draft</p>
              <button type="button" onClick={regenerate} disabled={regenerating}
                className="inline-flex items-center gap-1.5 font-mono text-sm uppercase tracking-[0.1em] text-court-chart hover:text-court-ice disabled:opacity-60">
                <RefreshCw className={cn("h-4 w-4", regenerating && "animate-spin")} />
                {regenerating ? "Generating…" : "Regenerate"}
              </button>
            </div>
            {regenNotice && (
              <p className="mb-2 font-mono text-sm text-court-chart">{regenNotice}</p>
            )}
            <div className="space-y-2">
              {drafts.map((d, i) => {
                const expanded = expandedDraft === i;
                const selected = selectedIndex === i;
                return (
                  <div key={i} className={cn("border-2 p-3 transition-colors", selected ? "border-court-chart bg-court-uv" : "border-court-ice bg-court-navy")}>
                    <p className={cn("font-mono text-sm text-court-ice leading-relaxed whitespace-pre-wrap break-words", !expanded && "line-clamp-3")}>{d}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => selectDraft(i)}
                        className="inline-flex items-center gap-1.5 bg-court-chart text-court-navy font-display uppercase tracking-[0.06em] text-sm px-3 py-1.5 border-2 border-court-navy hover:brightness-105 transition-all">
                        <Pencil className="h-3.5 w-3.5" /> Use & Edit This Draft
                      </button>
                      <button type="button" onClick={() => setExpandedDraft(expanded ? -1 : i)}
                        className="inline-flex items-center gap-1 font-mono text-sm text-court-mute hover:text-court-ice">
                        {expanded ? <><ChevronUp className="h-3.5 w-3.5" /> Collapse</> : <><ChevronDown className="h-3.5 w-3.5" /> View Full Draft</>}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* EDIT YOUR POST */}
          <section ref={editorWrapRef}>
            <p className="font-display uppercase tracking-[0.08em] text-court-chart text-sm mb-2">Edit Your Post</p>
            <textarea
              ref={editorRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_POST_TEXT))}
              rows={5}
              className="w-full border-2 border-court-ice bg-court-navy p-3 font-mono text-sm text-court-ice leading-relaxed focus:border-court-chart focus:outline-none resize-y"
              aria-label="Edit your post"
            />
            <div className="mt-1 flex items-center justify-between font-mono text-sm">
              <span className="text-court-mute">Max {MAX_POST_TEXT} chars</span>
              <span className={cn(overXLimit(text) ? "text-court-red" : "text-court-mute")}>
                {text.length} / {X_CHAR_LIMIT} (X limit)
              </span>
            </div>
            {xOverLimit && (
              <p className="mt-1 font-mono text-sm text-court-red leading-relaxed">
                X allows 280 characters. Shorten this post by {overBy} characters.
              </p>
            )}
            {editNotice && (
              <p className="mt-1 font-mono text-sm text-court-chart">{editNotice}</p>
            )}
          </section>

          {/* Optional X handle */}
          <section>
            <p className="font-mono text-sm uppercase tracking-[0.12em] text-court-mute mb-2">Optional X Handle</p>
            <div className="flex items-center gap-2">
              <div className="flex items-center border-2 border-court-ice bg-court-navy focus-within:border-court-chart">
                <span className="px-2 text-court-chart font-mono text-base">@</span>
                <input type="text" value={xHandle}
                  onChange={(e) => setXHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15))}
                  placeholder="yourhandle"
                  className="bg-transparent py-2 pr-2 font-mono text-sm text-court-ice placeholder:text-court-mute focus:outline-none w-40"
                  aria-label="Optional X handle" />
              </div>
              {xHandle && (
                <button type="button" onClick={removeHandle}
                  className="inline-flex items-center gap-1 font-mono text-sm uppercase tracking-[0.1em] text-court-red hover:text-court-ice">
                  <X className="h-3.5 w-3.5" /> Remove tag
                </button>
              )}
            </div>
          </section>

          {/* Verdict card preview (collapsed by default) */}
          <section>
            <button type="button" onClick={() => setCardOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 font-mono text-sm uppercase tracking-[0.1em] text-court-ice hover:text-court-chart">
              {cardOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Preview Attached Verdict Card
            </button>
            {cardOpen && (
              <div className="mt-2">
                <VerdictCardPreview trial={trial} className="w-full border-2 border-court-ice" />
              </div>
            )}
          </section>

          {/* WHERE SHOULD THIS GO? */}
          <section>
            <p className="font-display uppercase tracking-[0.08em] text-court-chart text-sm mb-2">Where Should This Go?</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {DESTINATIONS.map((d) => (
                <button key={d.id} type="button" onClick={() => chooseTarget(d.id)}
                  className={cn("text-left p-3 border-2 transition-colors",
                    target === d.id ? "bg-court-chart text-court-navy border-court-chart" : "bg-court-navy text-court-ice border-court-ice hover:bg-court-uv")}>
                  <span className="block font-display uppercase tracking-[0.06em] text-sm">{d.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 font-mono text-sm text-court-ice leading-relaxed">
              {DESTINATIONS.find((d) => d.id === target)?.desc}
            </p>
          </section>
        </div>

        {/* Sticky action footer */}
        <div className="shrink-0 border-t-2 border-court-ice bg-court-navy px-5 py-4 space-y-3">
          {doneX && (
            <div className="border-2 border-court-chart bg-court-uv p-3">
              <p className="font-display uppercase tracking-[0.06em] text-court-chart text-sm">X Composer Opened</p>
              <p className="mt-1 font-mono text-sm text-court-ice leading-relaxed">Review the post in X and press Post when you are ready. Wallet Court did not publish it for you.</p>
            </div>
          )}
          {doneShout && (
            <div className="border-2 border-court-chart bg-court-uv p-3">
              <p className="font-display uppercase tracking-[0.06em] text-court-chart text-sm">Submitted For Review</p>
              <p className="mt-1 font-mono text-sm text-court-ice leading-relaxed">This is now pending in the private ShoutIt Court Desk. It is not publicly visible and publication is not guaranteed.</p>
            </div>
          )}

          {message && (
            <p className="font-mono text-sm text-court-red leading-relaxed break-words">{message}</p>
          )}

          {/* Approvals — directly above the final button */}
          <div className="space-y-2">
            {wantsX && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} className="mt-1 h-4 w-4 accent-court-chart" />
                <span className="font-mono text-sm text-court-ice leading-relaxed">I've reviewed this post and want to open it in X.</span>
              </label>
            )}
            {wantsShout && (
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-court-chart" />
                <span className="font-mono text-sm text-court-ice leading-relaxed">I authorize ShoutIt to review and potentially publish this approved post, verdict card, case link, and optional X handle.</span>
              </label>
            )}
          </div>

          {/* Primary destination action */}
          <button type="button" onClick={publish} disabled={submitting || completed || xOverLimit}
            className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-60 disabled:shadow-none">
            <Megaphone className="h-5 w-5" /> {primaryLabel}
          </button>

          {/* Secondary utilities — visually separated */}
          <div className="pt-3 border-t border-court-mute/40">
            <p className="mb-2 font-mono text-sm text-court-mute leading-relaxed">
              Share Via Device opens your phone or computer's native share menu. It does not submit anything to ShoutIt.
            </p>
            <div className="flex flex-wrap gap-2">
              {hasNativeShare && (
                <button type="button" onClick={nativeShare}
                  className="inline-flex items-center justify-center gap-2 bg-court-uv text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-2.5 border-2 border-court-ice hover:brightness-110 transition-all">
                  <Share2 className="h-4 w-4" /> Share Via Device
                </button>
              )}
              <button type="button" onClick={copyText}
                className="inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-2.5 border-2 border-court-ice hover:bg-court-uv transition-colors">
                {copied ? <Check className="h-4 w-4 text-court-chart" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy Post Text"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}