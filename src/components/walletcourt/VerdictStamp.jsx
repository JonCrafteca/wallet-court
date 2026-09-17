import { motion } from "framer-motion";

export default function VerdictStamp({ trial }) {
  const competent = trial.verdict_code === "suspiciously_competent";
  const stampText = competent ? "Case Dismissed" : "Guilty";
  const stampTone = competent
    ? "border-court-ink text-court-ink"
    : "border-court-red text-court-red";

  return (
    <div className="text-center py-2">
      <motion.div
        initial={{ scale: 2.6, rotate: -22, opacity: 0 }}
        animate={{ scale: 1, rotate: -7, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 13, delay: 0.12 }}
        className={`inline-block border-[3px] ${stampTone} px-5 py-1.5 font-display font-black uppercase tracking-[0.14em] text-xl sm:text-2xl bg-court-paper`}
        style={{ boxShadow: "0 0 0 2px rgba(24,24,22,0.06)" }}
      >
        {stampText}
      </motion.div>
      <h2
        className="mt-5 font-display font-black uppercase leading-[0.88] text-court-ink"
        style={{ fontSize: "clamp(2.5rem, 7vw, 5rem)" }}
      >
        {trial.verdict_name}
      </h2>
      <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-court-gray">
        {trial.headline}
      </p>
    </div>
  );
}