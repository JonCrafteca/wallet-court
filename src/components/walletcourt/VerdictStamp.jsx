import { motion } from "framer-motion";
import { getStampText, getStampClasses } from "@/lib/verdictStamp";

export default function VerdictStamp({ trial }) {
  const text = getStampText(trial.verdict_code);
  const stampClasses = getStampClasses(trial.verdict_code);

  return (
    <div className="text-center py-2">
      <motion.div
        initial={{ scale: 2.6, rotate: -18, opacity: 0 }}
        animate={{ scale: 1, rotate: -6, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 13, delay: 0.12 }}
        className={`inline-block border-4 ${stampClasses} px-6 py-1.5 font-display uppercase tracking-[0.1em] text-2xl sm:text-3xl shadow-[5px_5px_0_0_#10142A]`}
      >
        {text}
      </motion.div>
      <h2
        className="mt-6 font-display uppercase leading-[0.84] text-court-ice"
        style={{ fontSize: "clamp(2.75rem, 8vw, 5.5rem)" }}
      >
        {trial.verdict_name}
      </h2>
      <p className="mt-4 font-mono text-base uppercase tracking-[0.15em] text-court-ice">
        {trial.headline}
      </p>
    </div>
  );
}