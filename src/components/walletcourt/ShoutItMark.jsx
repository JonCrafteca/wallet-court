import { Mic } from "lucide-react";
import { cn } from "@/lib/utils";

// Reusable ShoutIt distribution mark. Uses the lucide microphone as a temporary
// stand-in until an official ShoutIt SVG is available. Wallet Court colors only,
// so ShoutIt reads as the distribution engine — never a competing product brand.
const ICON_TONES = {
  chart: "text-court-chart",
  navy: "text-court-navy",
  ice: "text-court-ice",
  red: "text-court-red",
};

export default function ShoutItMark({
  withTagline = false,
  iconOnly = false,
  size = "sm",
  iconTone = "chart",
  textTone = "ice",
  className,
}) {
  const icon = size === "lg" ? "h-6 w-6" : size === "md" ? "h-5 w-5" : "h-4 w-4";
  const textSize = size === "lg" ? "text-xl" : size === "md" ? "text-base" : "text-sm";
  const textCls = textTone === "navy" ? "text-court-navy" : "text-court-ice";
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Mic className={cn(icon, ICON_TONES[iconTone] || ICON_TONES.chart)} aria-hidden />
      {!iconOnly && (
        <span className={cn("font-display uppercase tracking-[0.08em]", textSize, textCls)}>ShoutIt</span>
      )}
      {withTagline && (
        <span className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute border-l border-court-mute/40 pl-1.5">
          A ShoutIt Original
        </span>
      )}
    </span>
  );
}