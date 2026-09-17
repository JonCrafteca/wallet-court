import { useEffect, useState } from "react";
import { Gavel } from "lucide-react";

const MESSAGES = [
  "Checking for financial crimes against yourself…",
  "Interviewing disappointed stablecoins…",
  "Asking Smart Money if they saw you at the exit…",
  "Reviewing transactions your therapist should know about…",
  "Measuring how long you lasted after buying the top…",
  "Locating the exact moment your conviction became denial…",
];

export default function LoadingStage({ visible }) {
  const [idx, setIdx] = useState(0);
  const [line, setLine] = useState(1);

  useEffect(() => {
    if (!visible) return;
    setIdx(0);
    setLine(1);
    const msgTimer = setInterval(() => {
      setIdx((i) => (i + 1) % MESSAGES.length);
    }, 850);
    const lineTimer = setInterval(() => {
      setLine((l) => l + 1);
    }, 220);
    return () => {
      clearInterval(msgTimer);
      clearInterval(lineTimer);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-40 bg-court-bg/95 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-xl border border-court-line bg-court-surface p-6 sm:p-8">
        <div className="flex items-center gap-4 mb-6">
          <Gavel className="h-10 w-10 text-court-gold animate-gavel-strike shrink-0" />
          <div>
            <p className="text-[0.65rem] uppercase tracking-[0.2em] text-court-gold">Court in session</p>
            <p className="font-display font-bold uppercase text-court-text text-lg leading-tight">
              Examining the evidence
            </p>
          </div>
        </div>

        <div className="font-mono text-sm text-court-text/90 min-h-[3.5rem] flex items-start gap-2">
          <span className="text-court-gold">{">"}</span>
          <span className="animate-pulse">{MESSAGES[idx]}</span>
        </div>

        <div className="mt-6 border-t border-court-line pt-3 font-mono text-[0.7rem] text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>nansen evidence stream</span>
            <span className="text-court-gold">lines logged: {String(line).padStart(4, "0")}</span>
          </div>
          <div className="mt-2 h-1 w-full bg-court-bg overflow-hidden">
            <div className="h-full bg-court-gold animate-pulse" style={{ width: "100%" }} />
          </div>
        </div>
      </div>
    </div>
  );
}