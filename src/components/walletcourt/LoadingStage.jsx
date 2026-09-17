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
    <div className="fixed inset-0 z-40 bg-court-bg/95 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-xl">
        {/* folder tab */}
        <div className="flex">
          <div className="bg-court-folder border-2 border-b-0 border-court-ink px-4 py-1.5 -mb-px relative z-10">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-court-ink">
              Case File · Building
            </span>
          </div>
        </div>

        <div className="border-2 border-court-ink bg-court-folder">
          <div className="m-1 border border-court-ink/30 bg-court-paper p-5 sm:p-6">
            <div className="flex items-center gap-3 mb-4">
              <Gavel className="h-7 w-7 text-court-red shrink-0" />
              <div>
                <p className="text-[0.58rem] uppercase tracking-[0.2em] text-court-red font-mono">
                  Court in session
                </p>
                <p className="font-display font-bold uppercase text-court-ink text-lg leading-tight">
                  Filing the evidence
                </p>
              </div>
              <span className="ml-auto font-mono text-[0.58rem] uppercase tracking-[0.15em] text-court-gray">
                Exhibits filed: {String(filed.length).padStart(2, "0")}
              </span>
            </div>

            <div className="space-y-2 min-h-[9rem]">
              <AnimatePresence initial={false}>
                {filed.map((item, idx) => (
                  <motion.div
                    key={item.id}
                    initial={{ x: -28, opacity: 0, rotate: -0.6 }}
                    animate={{ x: 0, opacity: 1, rotate: -0.6 }}
                    transition={{ type: "spring", stiffness: 240, damping: 22 }}
                    className="relative border border-court-gray/50 bg-court-paper px-3 py-2 shadow-[2px_2px_0_0_rgba(24,24,22,0.08)]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[0.55rem] uppercase tracking-[0.15em] text-court-red border border-court-red/60 px-1">
                        Ex {EXHIBIT[idx % EXHIBIT.length]}
                      </span>
                      <span className="font-mono text-xs text-court-ink truncate">{item.msg}</span>
                    </div>
                    {/* redaction bar */}
                    <div className="mt-1.5 h-2 w-2/3 bg-court-ink overflow-hidden">
                      <div className="h-full w-full bg-court-ink" />
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <div className="mt-4 border-t border-court-gray/50 pt-2 font-mono text-[0.6rem] text-court-gray flex items-center justify-between">
              <span>nansen evidence stream</span>
              <span className="text-court-red animate-blink">● recording</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}