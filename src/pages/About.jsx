import { Link } from "react-router-dom";

const SECTIONS = [
  {
    title: "What Is Wallet Court?",
    body: "Wallet Court is an entertainment experience that puts your onchain trading behavior on trial. Enter a wallet address, the court reviews the evidence, and delivers a playful, courtroom-style verdict. It is parody — not financial advice, and never a judgment of you as a person.",
  },
  {
    title: "How the Court Uses Nansen Evidence",
    body: "When live mode is available, Wallet Court consults Nansen onchain data — trades, profit-and-loss, holding duration, and Smart Money positioning — to build the case file. The evidence shapes the verdict, the severity, and the confidence score. Roasts always target behavior, never identity.",
  },
  {
    title: "Demo Cases vs. Live Cases",
    body: "Demo cases use deterministic fixtures so the experience always delivers a verdict, even without live data. They are clearly labeled as Demo. Live cases are powered by real Nansen evidence and labeled Live · Nansen. Demo cases are never presented as live results, and rankings in The Hall always distinguish the two.",
  },
  {
    title: "Verdicts and Court Honors",
    body: "Every wallet receives one of a fixed set of verdicts, each with a severity and confidence score. The Hall of Shame ranks convicted wallets by severity, confidence, recency, and type. The Hall of Honor will recognize standout live cases — Bag of the Day, Dump of the Day, Escape Artist, Comeback Wallet, and Court Favorite — once eligible live cases exist.",
  },
  {
    title: "Claiming a Wallet",
    body: "Soon, wallet owners will be able to claim their address and add a public alias to their case. Claiming will verify ownership onchain — it will never change a verdict or alter evidence. Until then, all cases remain anonymous and sanitized.",
  },
];

export default function About() {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-10 sm:pt-14 pb-24">
      <header className="text-center mb-10">
        <h1
          className="font-display uppercase leading-[0.86] text-court-ice"
          style={{ fontSize: "clamp(2.2rem, 6vw, 4rem)" }}
        >
          About the Court
        </h1>
        <p className="mt-4 font-mono text-base text-court-ice max-w-xl mx-auto leading-relaxed">
          How Wallet Court works, what it measures, and what it never does.
        </p>
      </header>

      <div className="space-y-6">
        {SECTIONS.map((s) => (
          <div key={s.title} className="border-2 border-court-ice bg-court-navy p-5 sm:p-6">
            <h2 className="font-display uppercase tracking-[0.06em] text-court-chart text-xl sm:text-2xl mb-3">
              {s.title}
            </h2>
            <p className="font-mono text-base text-court-ice leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-10 text-center">
        <Link
          to="/"
          className="inline-flex items-center justify-center bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all"
        >
          Take the Stand
        </Link>
      </div>
    </section>
  );
}