import { Gavel, AlertTriangle, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

const CHYRON = [
  "The accused is presumed solvent until the evidence says otherwise.",
  "Failure to appear may result in continued bag-holding.",
  "The court accepts Ethereum, Base, Solana, and extremely poor judgment.",
];

export default function IntakeStage({ network, setNetwork, networks, address, setAddress, onSubmit, error }) {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-10 sm:pt-16 pb-24">
      {/* Hero */}
      <div className="text-center mb-10 sm:mb-12">
        <div className="inline-flex items-center gap-2 border-2 border-court-red bg-court-navy px-3 py-1 mb-6">
          <Radio className="h-4 w-4 text-court-ice animate-blink" />
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-court-ice">Live · Wallet Crime Unit</span>
        </div>
        <h1
          className="font-display uppercase leading-[0.84] text-court-ice"
          style={{ fontSize: "clamp(2.6rem, 7vw, 5rem)" }}
        >
          Your Wallet Has<br className="hidden sm:block" /> Been Subpoenaed
        </h1>
        <p className="mt-5 font-mono text-base text-court-ice max-w-xl mx-auto leading-relaxed">
          Nansen provides the onchain evidence. Wallet Court delivers the verdict.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={onSubmit}>
        <div className="border-4 border-court-ice bg-court-navy shadow-[8px_8px_0_0_#5127C7]">
          <div className="flex items-center justify-between border-b-2 border-court-ice bg-court-red px-4 py-2">
            <span className="font-display uppercase tracking-[0.1em] text-court-ice text-sm">
              Formal Summons · Onchain Division
            </span>
          </div>

          <div className="p-5 sm:p-7 space-y-6">
            {/* Network selector */}
            <div>
              <label className="block font-mono text-xs uppercase tracking-[0.16em] text-court-mute mb-2">
                Select Network
              </label>
              <div className="grid grid-cols-3 gap-2">
                {networks.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    onClick={() => setNetwork(n.id)}
                    className={cn(
                      "border-2 px-3 py-3 font-display uppercase tracking-[0.06em] text-sm transition-colors",
                      network === n.id
                        ? "bg-court-chart text-court-navy border-court-chart shadow-[3px_3px_0_0_#FF3B30]"
                        : "bg-court-navy text-court-ice border-court-ice hover:bg-court-uv"
                    )}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Address field */}
            <div>
              <label htmlFor="wallet-address" className="block font-mono text-xs uppercase tracking-[0.16em] text-court-mute mb-2">
                Wallet Address of the Accused
              </label>
              <div className="flex items-center border-2 border-court-ice bg-court-navy focus-within:border-court-chart transition-colors">
                <span className="px-3 text-court-red font-mono text-base select-none border-r border-court-mute">№</span>
                <input
                  id="wallet-address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="enter the address of the accused…"
                  spellCheck={false}
                  autoComplete="off"
                  className="w-full bg-transparent py-3 pr-3 font-mono text-base text-court-ice placeholder:text-court-mute focus:outline-none"
                />
              </div>
              {network === "solana" && (
                <p className="mt-2 font-mono text-sm text-court-mute">Solana addresses are base58, 32–44 characters.</p>
              )}
            </div>

            {/* Chyron annotations */}
            <div className="border-l-4 border-court-red pl-4 space-y-1.5">
              {CHYRON.map((note) => (
                <p key={note} className="font-mono text-sm text-court-ice leading-relaxed">
                  {note}
                </p>
              ))}
            </div>

            {error && (
              <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-3 text-sm text-court-red">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span className="font-mono leading-relaxed">{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="group w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-lg py-4 border-2 border-court-navy shadow-[5px_5px_0_0_#FF3B30] hover:shadow-none hover:translate-x-[5px] hover:translate-y-[5px] transition-all"
            >
              <Gavel className="h-5 w-5 group-hover:animate-gavel-strike" />
              Execute Subpoena
            </button>
            <p className="text-center font-mono text-xs uppercase tracking-[0.14em] text-court-mute">
              No account required · No wallet connection · Verdicts are parody
            </p>
          </div>
        </div>
      </form>

      <div className="mt-8 border-2 border-court-chart bg-court-uv px-4 py-3 text-center">
        <span className="mr-2 bg-court-chart px-2 py-1 font-bold uppercase tracking-wider text-court-navy text-xs">
          Guaranteed conviction
        </span>
        <span className="font-mono text-sm text-court-ice">
          Try <code className="text-court-chart">0x71c000000000000000000000000000000000c4f1</code> — it always returns{" "}
          <strong className="text-court-chart">One Pump Chump</strong>.
        </span>
      </div>
    </section>
  );
}