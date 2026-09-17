import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gavel } from "lucide-react";

const MESSAGES = [
  "Checking for financial crimes against yourself…",
  "Interviewing disappointed stablecoins…",
  "Asking Smart Money if they saw you at the exit…",
  "Reviewing transactions your therapist should know about…",
  "Measuring how long you lasted after buying the top…",
  "Locating the exact moment your conviction became denial…",
];

const EXHIBIT = ["A", "B", "C", "D", "E", "F"];

export default function LoadingStage({ visible }) {
  const [filed, setFiled] = useState([]);

  useEffect(() => {
    if (!visible) {
      setFiled([]);
      return;
    }
    let i = 0;
    let c = 0;
    setFiled([{ id: c++, msg: MESSAGES[0] }]);
    const timer = setInterval(() => {
      i = (i + 1) % MESSAGES.length;
      setFiled((prev) => [...prev, { id: c++, msg: MESSAGES[i] }].slice(-4));
    }, 950);
    return () => clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-40 bg-court-cobalt backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-xl">
        <div className="border-4 border-court-ice bg-court-navy shadow-[8px_8px_0_0_#5127C7]">
          <div className="flex items-center justify-between border-b-2 border-court-ice bg-court-red px-4 py-2">
            <span className="font-display uppercase tracking-[0.1em] text-court-ice text-sm">Case File · Building</span>
            <span className="font-mono text-xs uppercase tracking-[0.18em] text-court-ice animate-blink">● On Air</span>
          </div>

          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-3 mb-4">
              <Gavel className="h-7 w-7 text-court-chart shrink-0" />
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.18em] text-court-red">Court in session</p>
                <p className="font-display uppercase text-court-ice text-xl leading-tight">Filing the evidence</p>
              </div>
              <span className="ml-auto font-mono text-xs uppercase tracking-[0.14em] text-court-mute">
                Exhibits: {String(filed.length).padStart(2, "0")}
              </span>
            </div>

            <div className="space-y-2 min-h-[9rem]">
              <AnimatePresence initial={false}>
                {filed.map((item, idx) => (
                  <motion.div
                    key={item.id}
                    initial={{ x: -28, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 240, damping: 22 }}
                    className="border-2 border-court-ice bg-court-uv px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs uppercase tracking-[0.12em] text-court-navy border border-court-chart bg-court-chart px-1.5 py-0.5">
                        Ex {EXHIBIT[idx % EXHIBIT.length]}
                      </span>
                      <span className="font-mono text-base text-court-ice truncate">{item.msg}</span>
                    </div>
                    <div className="mt-1.5 h-2 w-2/3 bg-court-navy" />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="mt-4 border-t border-court-mute pt-2 font-mono text-xs text-court-mute flex items-center justify-between">
              <span>nansen evidence stream</span>
              <span className="text-court-chart animate-blink">● recording</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}