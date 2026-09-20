import { useEffect, useState } from "react";
import { Send, Loader2, ExternalLink, CheckCircle2, Share2, AlertTriangle, Edit3, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { getSummonsForCase, createSummons, updateSummonsStatus } from "@/lib/summons";
import { getClaimStatus } from "@/lib/walletClaim";
import { buildCaseUrl, xIntentUrl } from "@/lib/courtDispatch";
import { buildSummonsPost, truncateForX, resolveIdentityState, normalizeXHandleInput } from "@/lib/summonsHelpers";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";
import { X_CHAR_LIMIT } from "@/lib/shareConfig";
import { storeCapability, getCapability } from "@/lib/summonsCapability";

const STATE_STYLES = {
  anonymous_defendant: { color: "text-court-mute", bg: "bg-court-navy", border: "border-court-ice" },
  summons_ready: { color: "text-court-chart", bg: "bg-court-navy", border: "border-court-chart" },
  share_opened: { color: "text-court-chart", bg: "bg-court-uv", border: "border-court-chart" },
  summons_served: { color: "text-court-chart", bg: "bg-court-chart", border: "border-court-chart" },
  verified_wallet_owner: { color: "text-court-chart", bg: "bg-court-uv", border: "border-court-chart" },
  official_defense_filed: { color: "text-court-chart", bg: "bg-court-uv", border: "border-court-chart" },
};

export default function SummonsSection({ trial, proposedHandle }) {
  const { isAuthenticated } = useAuth();
  const [summons, setSummons] = useState(null);
  const [claimStatus, setClaimStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [handle, setHandle] = useState(proposedHandle || "");
  const [handleError, setHandleError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingHandle, setEditingHandle] = useState(false);
  const [editHandleValue, setEditHandleValue] = useState("");

  const caseUrl = buildCaseUrl(trial.public_slug);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [summonsRes, claimRes] = await Promise.all([
          getSummonsForCase(trial.public_slug),
          getClaimStatus(trial.public_slug),
        ]);
        if (!alive) return;
        setSummons(summonsRes?.summons || null);
        setClaimStatus(claimRes || null);
        if (summonsRes?.summons?.display_handle && !handle) {
          setHandle(summonsRes.summons.display_handle);
        }
      } catch {
        // ignore — sections degrade gracefully
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trial.public_slug]);

  const identity = resolveIdentityState({
    summons,
    claimStatus,
    defenseStatus: { hasPublicDefense: !!claimStatus?.official_defense },
  });
  const stateStyle = STATE_STYLES[identity.state] || STATE_STYLES.anonymous_defendant;

  // Edit capability: authenticated creator (is_creator) or anonymous management token
  const hasCapability = !!(summons?.summons_id && getCapability(summons.summons_id));
  const isCreator = summons?.is_creator === true;
  const canEdit = (isCreator || hasCapability) && summons?.status !== "summons_served_self_reported";
  const mgmtToken = summons?.summons_id ? getCapability(summons.summons_id) : null;

  async function handleServe() {
    setError("");
    setNotice("");
    setHandleError("");

    if (!handle.trim()) {
      setHandleError("Enter an X handle to serve the defendant.");
      return;
    }

    const validation = normalizeXHandleInput(handle);
    if (!validation.ok) {
      setHandleError(validation.error);
      return;
    }

    setBusy(true);
    try {
      const res = await createSummons({
        case_slug: trial.public_slug,
        display_handle: validation.handle,
      });
      if (res?.error) {
        if (res.duplicate && res.summons) {
          // 409: a defendant is already named for this case — use the existing summons
          setSummons(res.summons);
          setNotice("A defendant has already been named for this case.");
          setBusy(false);
          return;
        }
        setError(res.error);
        setBusy(false);
        return;
      }

      const newSummons = res?.summons;
      const token = res?.management_token || null;

      // Store management token for anonymous creators
      if (token && newSummons?.summons_id) {
        storeCapability(newSummons.summons_id, token);
      }

      setSummons(newSummons);
      trackShare(SHARE_EVENTS.SUMMONS_CREATED, { verdict_code: trial.verdict_code });

      // Build the summons post and open X
      const postText = buildSummonsPost(validation.handle, trial.verdict_name, caseUrl);
      const truncated = truncateForX(postText, X_CHAR_LIMIT);

      trackShare(SHARE_EVENTS.SUMMONS_SHARED);
      window.open(xIntentUrl(truncated), "_blank", "noopener,noreferrer");

      // Update status to share_opened
      if (newSummons?.summons_id) {
        const updateRes = await updateSummonsStatus({
          summons_id: newSummons.summons_id,
          status: "share_opened",
          share_method: "x_intent",
          management_token: token,
        });
        if (updateRes?.summons) setSummons(updateRes.summons);
      }

      setNotice("X opened with your summons. Posting remains under your control.");
    } catch (e) {
      setError(e?.message || "Could not serve the summons.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPosted() {
    if (!summons?.summons_id) return;
    setBusy(true);
    try {
      const res = await updateSummonsStatus({
        summons_id: summons.summons_id,
        status: "summons_served_self_reported",
        management_token: mgmtToken,
      });
      if (res?.error) {
        setError(res.error);
      } else {
        setSummons(res.summons);
        trackShare(SHARE_EVENTS.SUMMONS_SERVED);
        setNotice("Marked as served. This is self-reported — Wallet Court did not verify publication.");
      }
    } catch (e) {
      setError(e?.message || "Could not update summons status.");
    } finally {
      setBusy(false);
    }
  }

  function startEditHandle() {
    setEditHandleValue(summons?.display_handle || handle);
    setEditingHandle(true);
    setHandleError("");
    setError("");
    setNotice("");
  }

  async function handleSaveHandle() {
    if (!summons?.summons_id) return;
    const validation = normalizeXHandleInput(editHandleValue);
    if (!validation.ok) {
      setHandleError(validation.error);
      return;
    }
    setBusy(true);
    try {
      const res = await updateSummonsStatus({
        summons_id: summons.summons_id,
        display_handle: validation.handle,
        management_token: mgmtToken,
      });
      if (res?.error) {
        setError(res.error);
      } else {
        setSummons(res.summons);
        setHandle(validation.handle);
        setEditingHandle(false);
        setNotice("Defendant handle updated.");
      }
    } catch (e) {
      setError(e?.message || "Could not update handle.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-court-chart" />
          <span className="font-mono text-sm text-court-mute">Loading case identity…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Identity Status Panel */}
      <div className={cn("border-2 p-4 sm:p-5", stateStyle.border, stateStyle.bg)}>
        <div className="flex items-center gap-2 mb-2">
          {identity.state === "verified_wallet_owner" || identity.state === "official_defense_filed" ? (
            <CheckCircle2 className="h-5 w-5 text-court-chart" />
          ) : identity.state === "summons_served" ? (
            <Send className="h-5 w-5 text-court-navy" />
          ) : (
            <AlertTriangle className={cn("h-5 w-5", stateStyle.color)} />
          )}
          <span className={cn("font-display uppercase tracking-[0.06em] text-lg", stateStyle.color)}>
            {identity.label}
          </span>
        </div>
        {summons?.display_handle && (
          <div className="flex items-center gap-2">
            <p className="font-mono text-sm text-court-ice leading-relaxed">
              Intended Defendant:{" "}
              <span className="text-court-chart">@{summons.display_handle}</span>{" "}
              <span className="text-court-mute">· Unverified</span>
            </p>
            {canEdit && !editingHandle && (
              <button
                type="button"
                onClick={startEditHandle}
                disabled={busy}
                className="inline-flex items-center gap-1 font-mono text-xs text-court-chart hover:text-court-ice transition-colors disabled:opacity-60"
              >
                <Edit3 className="h-3 w-3" /> Edit
              </button>
            )}
          </div>
        )}
        {!summons?.display_handle && identity.state === "anonymous_defendant" && (
          <p className="font-mono text-sm text-court-mute leading-relaxed">
            No one has been named. Anyone can serve a summons to a defendant.
          </p>
        )}
      </div>

      {/* Handle edit form */}
      {editingHandle && (
        <div className="border-2 border-court-chart bg-court-navy p-4 sm:p-5">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">
            Edit Defendant Handle
          </p>
          <div className="flex items-center border-2 border-court-ice bg-court-navy focus-within:border-court-chart transition-colors">
            <span className="px-3 text-court-chart font-mono text-base select-none border-r border-court-mute">@</span>
            <input
              type="text"
              value={editHandleValue}
              onChange={(e) => { setEditHandleValue(e.target.value); setHandleError(""); }}
              placeholder="theirhandle"
              spellCheck={false}
              autoComplete="off"
              maxLength={50}
              aria-label="Edit defendant handle"
              className="w-full bg-transparent py-3 pr-3 font-mono text-base text-court-ice placeholder:text-court-mute focus:outline-none"
            />
          </div>
          {handleError && (
            <p className="mt-2 font-mono text-sm text-court-red leading-relaxed">{handleError}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleSaveHandle}
              disabled={busy}
              className="inline-flex items-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.08em] text-sm px-4 py-2 border-2 border-court-navy hover:brightness-105 transition-all disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Save Handle
            </button>
            <button
              type="button"
              onClick={() => { setEditingHandle(false); setHandleError(""); }}
              disabled={busy}
              className="inline-flex items-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2 border-2 border-court-ice hover:bg-court-uv transition-colors disabled:opacity-60"
            >
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* Serve the Defendant action — only show if no active summons or user can edit */}
      {(!summons || (!summons.display_handle && identity.state === "anonymous_defendant")) && !editingHandle && (
        <div className="border-2 border-court-ice bg-court-navy p-4 sm:p-5">
          <div className="flex items-start gap-3 mb-3">
            <Send className="h-6 w-6 text-court-chart shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-display uppercase tracking-[0.06em] text-court-ice text-lg">Serve the Defendant</p>
              <p className="font-mono text-sm text-court-mute leading-relaxed mt-1">
                Prepare a summons and open it in X. We never post automatically.
              </p>
            </div>
          </div>

          {/* Handle input */}
          <div className="space-y-2">
            <label htmlFor="summons-handle" className="block font-mono text-xs uppercase tracking-[0.14em] text-court-mute">
              Defendant's X Handle (optional)
            </label>
            <div className="flex items-center border-2 border-court-ice bg-court-navy focus-within:border-court-chart transition-colors">
              <span className="px-3 text-court-chart font-mono text-base select-none border-r border-court-mute">@</span>
              <input
                id="summons-handle"
                type="text"
                value={handle}
                onChange={(e) => {
                  setHandle(e.target.value);
                  setHandleError("");
                }}
                placeholder="theirhandle"
                spellCheck={false}
                autoComplete="off"
                maxLength={50}
                aria-label="Defendant's X handle"
                className="w-full bg-transparent py-3 pr-3 font-mono text-base text-court-ice placeholder:text-court-mute focus:outline-none"
              />
            </div>
            <p className="font-mono text-xs text-court-mute leading-relaxed">
              We'll use this only to prepare the summons. It does not prove who owns the wallet.
            </p>
            {handleError && (
              <p className="font-mono text-sm text-court-red leading-relaxed">{handleError}</p>
            )}
          </div>

          {/* Serve button */}
          <button
            type="button"
            onClick={handleServe}
            disabled={busy}
            className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 text-court-navy" />}
            {busy ? "Preparing…" : "Serve the Defendant"}
          </button>

          {/* Post-open notice */}
          {notice && (
            <div className="mt-3 border-2 border-court-chart bg-court-uv p-3">
              <p className="font-mono text-sm text-court-ice leading-relaxed">{notice}</p>
            </div>
          )}

          {/* Confirm posted button (self-reported) */}
          {summons?.status === "share_opened" && (
            <button
              type="button"
              onClick={handleConfirmPosted}
              disabled={busy}
              className="mt-2 w-full inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-chart hover:bg-court-uv transition-colors disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4 text-court-chart" /> I Posted the Summons
            </button>
          )}

          {/* Error */}
          {error && (
            <div className="mt-3 border-2 border-court-red bg-court-navy p-3">
              <p className="font-mono text-sm text-court-red leading-relaxed">{error}</p>
            </div>
          )}
        </div>
      )}

      {/* Confirm posted + error for existing summons with share_opened status */}
      {(summons?.status === "share_opened" || error) && (summons?.display_handle || editingHandle) && (
        <div className="space-y-2">
          {summons?.status === "share_opened" && !editingHandle && (
            <button
              type="button"
              onClick={handleConfirmPosted}
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.08em] text-sm px-4 py-2.5 border-2 border-court-chart hover:bg-court-uv transition-colors disabled:opacity-60"
            >
              <CheckCircle2 className="h-4 w-4 text-court-chart" /> I Posted the Summons
            </button>
          )}
          {error && (
            <div className="border-2 border-court-red bg-court-navy p-3">
              <p className="font-mono text-sm text-court-red leading-relaxed">{error}</p>
            </div>
          )}
          {notice && !editingHandle && (
            <div className="border-2 border-court-chart bg-court-uv p-3">
              <p className="font-mono text-sm text-court-ice leading-relaxed">{notice}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}