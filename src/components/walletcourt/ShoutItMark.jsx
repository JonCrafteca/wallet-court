import { cn } from "@/lib/utils";

// Reusable ShoutIt brand mark. Renders the official ShoutIt logo (alt="ShoutIt")
// plus an optional "A ShoutIt Original" tagline. Wallet Court colors only, exact
// brand casing — never uppercased. ShoutIt reads as the distribution engine,
// never a competing product brand.
//
// NOTE: The official logo asset (shoutit-logo.png) lives in the separate ShoutIt
// application and could not be accessed cross-app from here. The logo <img> is
// intentionally NOT substituted with another design — it will be added once the
// original shoutit-logo.png file is supplied.
export default function ShoutItMark({ withTagline = false, size = "sm", textTone = "ice", className }) {
  const textSize = size === "lg" ? "text-xl" : size === "md" ? "text-base" : "text-sm";
  const textCls = textTone === "navy" ? "text-court-navy" : "text-court-ice";
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("font-display tracking-[0.04em]", textSize, textCls)}>ShoutIt</span>
      {withTagline && (
        <span className="font-mono text-xs tracking-[0.14em] text-court-mute border-l border-court-mute/40 pl-1.5">
          A ShoutIt Original
        </span>
      )}
    </span>
  );
}