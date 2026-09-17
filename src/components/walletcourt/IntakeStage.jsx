import { Gavel, AlertTriangle, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

const CHYRON = [
  "The accused is presumed solvent until the evidence says otherwise.",
  "Failure to appear may result in continued bag-holding.",
  "The court accepts Ethereum, Base, Solana, and extremely poor judgment.",
];

export default function IntakeStage({ network, setNetwork, networks, address, setAddress, onSubmit, error }) {
  return (
    <section className="court-stage mx-auto max-w-4xl px-4 pt-8 sm:pt-12 pb-20">
      {/* Hero arrival */}
      <div className="relative text-center mb-7 sm:mb-9">
        <div className="pointer-events-none absolute -top-8 -left-2 h-16 w-16 bg-court-uv border-2 border-court-ice hidden sm:block" aria-hidden />
        <div className="pointer-events-none absolute -bottom-6 -right-1 h-10 w-28 bg-court-uv border-2 border-court-red hidden sm:block" aria-hidden />
        <div className="court-kicker relative inline-flex items-center gap-2 border-2 px-3 py-1 mb-5">
          <Radio className="h-3.5 w-3.5 text-court-red animate-blink" />
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.24em]">Live · Wallet Crime Unit</span>
        </div>
        <h1
          className="font-display uppercase leading-[0.84] text-court-ice"
          style={{ fontSize: "clamp(2.6rem, 7vw, 5rem)" }}
        >
          Your Wallet Has<br className="hidden sm:block" /> Been Subpoenaed
        </h1>
        <p className="relative mt-4 font-mono text-sm text-court-ice max-w-xl mx-auto">
          Nansen provides the onchain evidence. Wallet Court delivers the verdict.
        </p>
      </div>

      {/* Broadcast docket panel */}
      <form onSubmit={onSubmit} className="relative">
        <div className="court-docket border-4">
          {/* warning strip */}
          <div className="court-warning flex items-center justify-between border-b-2 px-4 py-2">
            <span className="font-display uppercase tracking-[0.12em] text-court-ice text-sm">Formal Summons · Onchain Division</span>
            <span className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-court-ice">Docket · WC-INTAKE</span>
          </div>

          <div className="p-4 sm:p-6 space-y-5">
            {/* Network selector */}
            <div>
              <label className="block font-mono text-[0.62rem] uppercase tracking-[0.18em] text-court-mute mb-2">
                Select Network
              </label>
              <div className="grid grid-cols-3 gap-2">
                {networks.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    onClick={() => setNetwork(n.id)}
                    className={cn(
                      "court-network border-2 px-3 py-2.5 font-display uppercase tracking-[0.06em] text-sm transition-colors",
                      network === n.id ? "court-network-active" : ""
                    )}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Address field */}
            <div>
              <label htmlFor="wallet-address" className="block font-mono text-[0.62rem] uppercase tracking-[0.18em] text-court-mute mb-2">
                Wallet Address of the Accused
              </label>
              <div className="court-input flex items-center border-2 transition-colors">
                <span className="px-3 text-court-red font-mono text-sm select-none border-r border-court-mute">№</span>
                <input
                  id="wallet-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="enter the address of the accused…"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full bg-transparent py-3 pr-3 font-mono text-sm text-court-ice placeholder:text-court-mute focus:outline-none"
                />
              </div>
              {network === "solana" && (
                <p className="mt-1.5 font-mono text-[0.62rem] text-court-mute">
                  Solana addresses are base58, 32–44 chars.
                </p>
              )}
            </div>

            {/* Chyron annotations */}
            <div className="border-l-4 border-court-red pl-3 space-y-1">
              {CHYRON.map((note) => (
                <p key={note} className="font-mono text-[0.66rem] text-court-mute leading-snug">
                  {note}
                </p>
              ))}
            </div>

            {error && (
              <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-2 text-sm text-court-red">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="font-mono">{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="court-action group w-full inline-flex items-center justify-center gap-2 font-display uppercase tracking-[0.12em] text-lg py-4 border-2 transition-all"
            >
              <Gavel className="h-5 w-5 group-hover:animate-gavel-strike" />
              Execute Subpoena
            </button>
            <p className="text-center font-mono text-[0.6rem] uppercase tracking-[0.15em] text-court-mute">
              No account required · No wallet connection · Verdicts are parody
            </p>
          </div>
        </div>
      </form>

      <div className="court-proof-strip mt-7 border-2 px-4 py-3 text-center font-mono text-[0.68rem]">
        <span className="mr-2 bg-court-chart px-2 py-1 font-bold uppercase tracking-wider text-court-navy">Guaranteed conviction</span>
        Try <code className="text-court-chart">0x71c000000000000000000000000000000000c4f1</code>
        {" "}— it always returns <strong className="text-court-chart">One Pump Chump</strong>.
      </div>
    </section>
  );
}