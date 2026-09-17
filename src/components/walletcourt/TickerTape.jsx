const PHRASES = [
  "GUILTY VERDICTS ISSUED 24/7",
  "NANSEN EVIDENCE STREAM · LIVE",
  "THE ACCUSED IS PRESUMED SOLVENT UNTIL THE EVIDENCE SAYS OTHERWISE",
  "FAILURE TO APPEAR MAY RESULT IN CONTINUED BAG-HOLDING",
  "COURT ACCEPTS ETH · BASE · SOL · POOR JUDGMENT",
  "VERDICTS ARE PARODY · NOT FINANCIAL ADVICE",
];

const COLORS = ["text-court-ice", "text-court-chart", "text-court-red"];

export default function TickerTape() {
  return (
    <div className="overflow-hidden bg-court-navy border-y-2 border-court-ice">
      <div className="flex w-max animate-marquee">
        {[0, 1].map((dup) => (
          <div key={dup} className="flex shrink-0 items-center" aria-hidden={dup === 1}>
            {PHRASES.map((p, i) => (
              <span
                key={i}
                className={`flex items-center gap-2 px-4 py-1.5 font-mono text-[0.62rem] uppercase tracking-[0.18em] ${COLORS[i % COLORS.length]}`}
              >
                {p}
                <span className="text-court-ice">■</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}