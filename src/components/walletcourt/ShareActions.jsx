import { useState } from "react";
import { Megaphone, Swords, Download, Copy, Check, Gavel } from "lucide-react";
import { cn } from "@/lib/utils";
import { base44 } from "@/api/base44Client";
import { buildCaseUrl } from "@/lib/courtDispatch";
import { downloadVerdictCard } from "@/lib/verdictCard";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";
import ShoutModal from "./ShoutModal";
import ChallengeModal from "./ChallengeModal";

export default function ShareActions({ trial, onReset }) {
  const [shoutOpen, setShoutOpen] = useState(false);
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const url = buildCaseUrl(trial.public_slug);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      trackShare(SHARE_EVENTS.CASE_LINK_COPIED);
      setTimeout(() => setLinkCopied(false), 1800);
    } catch {
      // ignore
    }
  }

  async function downloadCard() {
    setDownloading(true);
    try {
      await downloadVerdictCard(trial);
      trackShare(SHARE_EVENTS.VERDICT_CARD_DOWNLOADED, { verdict_code: trial.verdict_code, data_mode: trial.data_mode });
    } catch {
      // ignore
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setShoutOpen(true)}
        className="w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-lg px-4 py-4 border-2 border-court-navy shadow-[5px_5px_0_0_#FF3B30] hover:shadow-none hover:translate-x-[5px] hover:translate-y-[5px] transition-all"
      >
        <Megaphone className="h-5 w-5" /> Shout This Verdict
      </button>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setChallengeOpen(true)}
          className="inline-flex items-center justify-center gap-2 bg-court-uv text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-3 border-2 border-court-ice hover:brightness-110 transition-all"
        >
          <Swords className="h-4 w-4" /> Challenge a Trader
        </button>
        <button
          type="button"
          onClick={downloadCard}
          disabled={downloading}
          className="inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-3 border-2 border-court-ice hover:bg-court-uv transition-colors disabled:opacity-60"
        >
          <Download className="h-4 w-4" /> Verdict Card
        </button>
        <button
          type="button"
          onClick={copyLink}
          className="inline-flex items-center justify-center gap-2 bg-court-navy text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-3 border-2 border-court-ice hover:bg-court-uv transition-colors"
        >
          {linkCopied ? <Check className="h-4 w-4 text-court-chart" /> : <Copy className="h-4 w-4" />}
          {linkCopied ? "Copied" : "Copy Case Link"}
        </button>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center justify-center gap-2 bg-court-red text-court-ice font-display uppercase tracking-[0.08em] text-sm px-3 py-3 border-2 border-court-ice hover:brightness-105 transition-all"
        >
          <Gavel className="h-4 w-4" /> Roast Another
        </button>
      </div>

      <ShoutModal trial={trial} open={shoutOpen} onOpenChange={setShoutOpen} />
      <ChallengeModal trial={trial} open={challengeOpen} onOpenChange={setChallengeOpen} />
    </div>
  );
}