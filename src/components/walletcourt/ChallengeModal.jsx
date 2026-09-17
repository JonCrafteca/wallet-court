import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Swords, Twitter, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { base44 } from "@/api/base44Client";
import { buildDraft, buildChallengeUrl, xIntentUrl } from "@/lib/courtDispatch";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";

export default function ChallengeModal({ trial, open, onOpenChange }) {
  const [handles, setHandles] = useState(["", "", ""]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [challengeSlug, setChallengeSlug] = useState("");
  const [post, setPost] = useState("");

  function reset() {
    setHandles(["", "", ""]);
    setError("");
    setChallengeSlug("");
    setPost("");
  }

  function onOpen(v) {
    if (!v) reset();
    onOpenChange(v);
  }

  function validate() {
    const cleaned = handles
      .map((h) => h.trim().replace(/^@/, ""))
      .filter(Boolean)
      .map((h) => h.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 15))
      .filter(Boolean);
    const dedup = [...new Set(cleaned)].slice(0, 3);
    if (dedup.length === 0) return { error: "Add at least one X handle.", ok: null };
    for (const h of dedup) {
      if (!/^[a-zA-Z0-9_]{1,15}$/.test(h)) return { error: "Handles may only contain letters, numbers, and underscores.", ok: null };
    }
    return { error: null, ok: dedup };
  }

  async function create() {
    setError("");
    const { error, ok } = validate();
    if (error || !ok) {
      setError(error || "Invalid handles.");
      return;
    }
    setCreating(true);
    try {
      const res = await base44.functions.invoke("createChallenge", {
        source_case_slug: trial.public_slug,
        challenged_handles: ok,
      });
      if (res?.data?.error) {
        setError(res.data.error);
        return;
      }
      const slug = res.data.challenge_slug;
      const challengeUrl = buildChallengeUrl(trial.public_slug, slug);
      const draft = buildDraft(trial, "challenge_post", { challengeHandles: ok, challengeUrl }, 0);
      setChallengeSlug(slug);
      setPost(draft);
      trackShare(SHARE_EVENTS.CHALLENGE_CREATED, { handle_count: ok.length });
    } catch (e) {
      setError(e?.message || "Challenge creation failed.");
    } finally {
      setCreating(false);
    }
  }

  function postToX() {
    trackShare(SHARE_EVENTS.X_COMPOSER_OPENED);
    window.open(xIntentUrl(post), "_blank", "noopener,noreferrer");
  }

  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogContent className="bg-court-navy text-court-ice border-2 border-court-ice max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display uppercase tracking-[0.06em] text-court-ice text-2xl">
            Challenge a Trader
          </DialogTitle>
          <DialogDescription className="font-mono text-sm text-court-mute">
            Summon up to three wallets to face the court. No messages are sent — you post the challenge yourself.
          </DialogDescription>
        </DialogHeader>

        {!challengeSlug ? (
          <>
            <div className="space-y-2">
              {handles.map((h, i) => (
                <div key={i} className="flex items-center border-2 border-court-ice bg-court-navy focus-within:border-court-chart">
                  <span className="px-3 text-court-chart font-mono text-base">@</span>
                  <input
                    type="text"
                    value={h}
                    onChange={(e) => setHandles((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
                    placeholder={`handle ${i + 1}`}
                    maxLength={15}
                    className="bg-transparent py-2.5 pr-3 font-mono text-sm text-court-ice placeholder:text-court-mute focus:outline-none w-full"
                    aria-label={`X handle ${i + 1}`}
                  />
                </div>
              ))}
            </div>
            <p className="font-mono text-xs text-court-mute">Optional leading @ · 1–15 characters · letters, numbers, underscores. Duplicates are removed.</p>

            {error && (
              <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-2 text-sm text-court-red">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="font-mono leading-relaxed">{error}</span>
              </div>
            )}

            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all disabled:opacity-60"
            >
              <Swords className="h-5 w-5" /> Create Challenge
            </button>
          </>
        ) : (
          <>
            <div className="border-2 border-court-chart bg-court-uv p-3">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-chart mb-2">Your Challenge Post</p>
              <p className="font-mono text-sm text-court-ice leading-relaxed whitespace-pre-wrap break-words">{post}</p>
            </div>
            <button
              type="button"
              onClick={postToX}
              className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all"
            >
              <Twitter className="h-5 w-5" /> Post Challenge to X
            </button>
            <p className="font-mono text-xs text-court-mute leading-relaxed">
              X will open so you can review and publish the challenge. The defendant accepts at the challenge link.
            </p>
            <button
              type="button"
              onClick={reset}
              className="w-full font-mono text-xs uppercase tracking-[0.12em] text-court-ice hover:text-court-chart"
            >
              Start a new challenge
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}