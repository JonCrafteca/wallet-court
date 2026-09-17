import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Quote } from "lucide-react";

const REACTIONS = [
  {
    handle: "@paperhands69",
    text: "The court called me a One Pump Chump and honestly my transaction history offered no defense.",
  },
  {
    handle: "@exitliquidity",
    text: "I would like to appeal. Unfortunately, I sold the appeal 11 minutes after filing it.",
  },
  {
    handle: "@bagholder",
    text: "Diamond-Handed Hostage is a medically accurate diagnosis.",
  },
];

export default function ShoutItGallery() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActive((a) => (a + 1) % REACTIONS.length), 4200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="font-display uppercase tracking-[0.1em] text-court-ice text-base">
          ShoutIt Public Gallery
        </h3>
        <span className="font-mono text-[0.52rem] uppercase tracking-[0.14em] text-court-red">
          Dramatized Courtroom Chatter · Live ShoutIt Reactions Coming Soon
        </span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {REACTIONS.map((r, i) => (
          <motion.div
            key={r.handle}
            animate={{ scale: active === i ? 1.02 : 1, rotate: i % 2 ? 0.5 : -0.5 }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
            className={`relative bg-court-navy border-2 p-4 ${
              active === i
                ? "border-court-chart shadow-[5px_5px_0_0_#D8FF32]"
                : "border-court-ice"
            }`}
          >
            <Quote className="h-4 w-4 text-court-red mb-2" />
            <p className="font-mono text-court-ice text-sm leading-relaxed">
              “{r.text}”
            </p>
            <p className="mt-3 font-mono text-xs text-court-chart">— {r.handle}</p>
          </motion.div>
        ))}
      </div>

      <p className="mt-3 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-court-ice">
        Dramatized reactions. Not real posts. No like, repost, follower, or verification counts shown.
      </p>
    </div>
  );
}