import { motion } from "framer-motion";
import { Gavel } from "lucide-react";
import { displayAddressShort } from "@/lib/wallet";

// Phase N2.3 — public Case Dismissed experience. Shown when the evidence gate
// classified a successful-but-empty Nansen profile. No verdict, severity,
// confidence, charge, sentence, evidence badge, share, challenge, or badges.
export default function CaseDismissed({ trial, onReset }) {
  const shortAddr = displayAddressShort(trial);
  const network = (trial.network || "ethereum").toUpperCase();

  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:pt-12 pb-20">
      {/* Slim case header — identity preserved, no verdict label */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-mono text-xs uppercase tracking-[0.14em] mb-8 border-2 border-court-ice bg-court-navy px-4 py-2">
        <span className="text-court-chart font-bold">Case No. {trial.public_slug?.slice(-8).toUpperCase()}</span>
        <span className="text-court-ice">{trial.network} · {shortAddr}</span>
        <span className="text-court-chart">Live · Nansen</span>
      </div>

      {/* Case Dismissed stamp — dark navy bg, chartreuse text, 3px chartreuse border, hard black offset shadow, slight rotation */}
      <div className="text-center py-2">
        <motion.div
          initial={{ scale: 2.6, rotate: -18, opacity: 0 }}
          animate={{ scale: 1, rotate: -4, opacity: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 13, delay: 0.12 }}
          className="inline-block border-[3px] border-court-chart bg-court-navy px-8 py-3 font-display uppercase tracking-[0.1em] text-2xl sm:text-4xl text-court-chart shadow-[7px_7px_0_0_#000000]"
        >
          Case Dismissed
        </motion.div>
        <p className="mt-6 font-display uppercase tracking-[0.16em] text-court-chart text-xl sm:text-3xl">
          Insufficient Evidence
        </p>
        <p className="mt-3 font-mono text-sm text-court-mute leading-relaxed">
          No Receipts. No Conviction.
        </p>
      </div>

      {/* Findings — public-safe, no guilt language */}
      <div className="mt-10 border-2 border-court-ice bg-court-navy p-5 sm:p-6">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-court-chart mb-3">Findings · For the Record</p>
        <p className="font-mono text-court-ice leading-relaxed text-base">
          Nansen found no qualifying {network} activity for this address during the evidence window.
        </p>
        <p className="mt-4 font-mono italic text-court-mute leading-relaxed text-base">
          The blockchain may never forget, but apparently there was nothing worth remembering.
        </p>
      </div>

      {/* Reset only — no share, no challenge, no badges */}
      <div className="mt-10">
        <button
          type="button"
          onClick={onReset}
          className="w-full inline-flex items-center justify-center gap-2 bg-court-red text-court-ice font-display uppercase tracking-[0.08em] text-base px-4 py-4 border-2 border-court-ice hover:brightness-105 transition-all"
        >
          <Gavel className="h-5 w-5" /> Roast Another Wallet
        </button>
      </div>
    </section>
  );
}