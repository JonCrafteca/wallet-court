import { motion } from "framer-motion";

export default function VerdictStamp({ trial }) {
  const competent = trial.verdict_code === "suspiciously_competent";
  const text = competent ? "Case Dismissed" : "Guilty";
  const tone = competent
    ? "border-court-chart text-court-chart"
    : "border-court-red text-court-red";

  return (
    <div className="text-center py-2">
      <motion.div
        initial={{ scale: 2.6, rotate: -18, opacity: 0 }}
        animate={{ scale: 1, rotate: -6, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 13, delay: 0.12 }}
        className={`inline-block border-4 ${tone} bg-court-ice px-6 py-1.5 font-display uppercase tracking-[0.1em] text-2xl sm:text-3xl shadow-[5px_5px_0_0_#10142A]`}
      >
        {text}
      </motion.div>
      <h2
        className="mt-6 font-display uppercase leading-[0.84] text-court-ice"
        style={{ fontSize: "clamp(2.75rem, 8vw, 5.5rem)" }}
      >
        {trial.verdict_name}
      </h2>
      <p className="mt-3 font-mono text-xs uppercase tracking-[0.2em] text-court-chart">
        {trial.headline}
      </p>
    </div>
  );
}