import { useState } from "react";
import { cn } from "@/lib/utils";

// Official ShoutIt brand assets, stored locally (same-origin) so they render in
// the verdict-card canvas without CORS taint.
const MASCOT_SRC = "/brand/shoutit-mascot-round.png";
const LOCKUP_SRC = "/brand/shoutit-lockup.png";

function Tagline() {
  return (
    <span className="font-mono text-xs tracking-[0.14em] text-court-mute border-l border-court-mute/40 pl-1.5">
      A ShoutIt Original
    </span>
  );
}

// Reusable ShoutIt mark.
//   variant="mascot" — round mascot image, circularly clipped (object-cover)
//   variant="lockup" — full mascot + wordmark (object-contain)
//   variant="text"   — exact-case textual fallback (also used on image error)
//   showTagline      — optionally append "A ShoutIt Original"
// Wallet Court colors only; ShoutIt is the distribution engine, never a competing
// product brand. All text uses exact "ShoutIt" casing — never uppercased.
export default function ShoutItMark({
  variant = "text",
  showTagline = false,
  size = 36,
  lockupWidth = 200,
  className,
  textTone = "ice",
}) {
  const [failed, setFailed] = useState(false);
  const px = Math.max(28, size);
  const textCls = textTone === "navy" ? "text-court-navy" : "text-court-ice";

  if (variant === "mascot" && !failed) {
    return (
      <span className={cn("inline-flex items-center gap-2", className)}>
        <img
          src={MASCOT_SRC}
          alt="ShoutIt mascot"
          width={px}
          height={px}
          className="rounded-full object-cover shrink-0 ring-1 ring-court-ice/40"
          style={{ width: px, height: px }}
          onError={() => setFailed(true)}
        />
        {showTagline && <Tagline />}
      </span>
    );
  }

  if (variant === "lockup" && !failed) {
    return (
      <img
        src={LOCKUP_SRC}
        alt="ShoutIt"
        className={cn("object-contain block", className)}
        style={{ width: Math.max(120, lockupWidth) }}
        onError={() => setFailed(true)}
      />
    );
  }

  // text variant — default and graceful fallback when an image fails to load
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("font-display tracking-[0.04em] text-base", textCls)}>ShoutIt</span>
      {showTagline && <Tagline />}
    </span>
  );
}