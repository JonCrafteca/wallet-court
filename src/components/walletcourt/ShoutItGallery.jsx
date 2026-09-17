import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Quote } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div className="border-2 border-court-ice bg-court-navy p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h3 className="font-display uppercase tracking-[0.08em] text-court-ice text-xl">
          ShoutIt Public Gallery
        </h3>
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-court-red">
          Dramatized Courtroom Chatter · Live ShoutIt Reactions Coming Soon
        </span>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {REACTIONS.map((r, i) => (
          <motion.div
            key={r.handle}
            animate={{ scale: active === i ? 1.02 : 1 }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
            className={cn(
              "relative bg-court-uv border-2 p-4",
              active === i ? "border-court-chart" : "border-court-ice"
            )}
          >
            <Quote className="h-4 w-4 text-court-red mb-2" />
            <p className="font-mono text-court-ice text-base leading-relaxed">“{r.text}”</p>
            <p className="mt-3 font-mono text-xs text-court-chart">— {r.handle}</p>
          </motion.div>
        ))}
      </div>

      <p className="mt-4 font-mono text-xs uppercase tracking-[0.12em] text-court-mute">
        Dramatized reactions. Not real posts. No like, repost, follower, or verification counts shown.
      </p>
    </div>
  );
}