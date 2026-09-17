import { useEffect, useRef } from "react";
import { drawVerdictCard } from "@/lib/verdictCard";

export default function VerdictCardPreview({ trial, className }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    let active = true;
    (async () => {
      try {
        await drawVerdictCard(ref.current, trial);
      } catch {
        // ignore render errors in preview
      }
      active = false;
    })();
    return () => {
      active = false;
    };
  }, [trial]);

  return (
    <canvas
      ref={ref}
      width={600}
      height={338}
      className={className}
      aria-label="Verdict card preview"
    />
  );
}