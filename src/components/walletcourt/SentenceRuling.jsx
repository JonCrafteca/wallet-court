// The Sentence is the court's ruling — the dramatic climax of the verdict.
// Kept deliberately bold: the sentence text is the dominant content.
export default function SentenceRuling({ trial }) {
  return (
    <div className="relative mt-10 bg-court-navy border-2 border-court-ice shadow-[10px_10px_0_0_#D8FF32] p-6 sm:p-10 overflow-hidden">
      {/* Slightly rotated red outlined SENTENCED stamp */}
      <div className="absolute top-3 right-4 sm:top-5 sm:right-8 -rotate-[8deg]">
        <span className="inline-block border-4 border-court-red text-court-red font-display uppercase tracking-[0.14em] text-base sm:text-xl px-3 py-1 bg-court-navy">
          Sentenced
        </span>
      </div>

      <p className="font-mono text-sm uppercase tracking-[0.24em] text-court-chart mb-5">
        The Court Rules
      </p>

      <p className="font-display uppercase text-court-ice leading-[0.95] tracking-[0.02em] text-[2rem] sm:text-[3rem] md:text-[3.25rem] drop-shadow-[3px_3px_0_#5127C7]">
        {trial.sentence}
      </p>

      <div className="mt-6 h-1 w-24 bg-court-chart" />
    </div>
  );
}