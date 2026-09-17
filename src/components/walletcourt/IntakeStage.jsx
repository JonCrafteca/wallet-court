import { Gavel, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const CLERK_NOTES = [
  "The accused is presumed solvent until the evidence says otherwise.",
  "Failure to appear may result in continued bag-holding.",
  "The court accepts Ethereum, Base, Solana, and extremely poor judgment.",
];

export default function IntakeStage({ network, setNetwork, networks, address, setAddress, onSubmit, error }) {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:pt-12 pb-20">
      {/* Hero arrival */}
      <div className="text-center mb-7 sm:mb-9">
        <p className="text-[0.62rem] uppercase tracking-[0.3em] text-court-red mb-3 font-mono">
          Case File · WC-0001 · Public Filing
        </p>
        <h1
          className="font-display font-black uppercase leading-[0.95] text-court-ink"
          style={{ fontSize: "clamp(2rem, 4.6vw, 3.5rem)" }}
        >
          Your Wallet Has Been<br className="hidden sm:block" /> Subpoenaed.
        </h1>
        <p className="mt-4 text-sm text-court-gray max-w-xl mx-auto">
          Nansen provides the onchain evidence. Wallet Court delivers the verdict.
        </p>
      </div>

      {/* Formal Summons — manila case folder */}
      <form onSubmit={onSubmit} className="relative">
        {/* folder tab */}
        <div className="flex">
          <div className="bg-court-folder border-2 border-b-0 border-court-ink px-4 py-1.5 -mb-px relative z-10">
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.2em] text-court-ink">
              Formal Summons · Onchain Division
            </span>
          </div>
          <div className="flex-1" />
        </div>

        <div className="border-2 border-court-ink bg-court-folder">
          <div className="m-1 border border-court-ink/30 bg-court-paper doc-lines">
            {/* folder header strip */}
            <div className="flex items-center justify-between border-b border-court-gray/50 px-4 py-2 bg-court-paper">
              <span className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-court-gray">
                Docket · WC-INTAKE
              </span>
              <span className="font-mono text-[0.58rem] uppercase tracking-[0.2em] text-court-red">
                Public Filing
              </span>
            </div>

            <div className="p-4 sm:p-6 space-y-5">
              {/* Network selector */}
              <div>
                <label className="block text-[0.62rem] uppercase tracking-[0.18em] text-court-gray mb-2 font-mono">
                  Select Network
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {networks.map((n) => (
                    <button
                      type="button"
                      key={n.id}
                      onClick={() => setNetwork(n.id)}
                      className={cn(
                        "border-2 px-3 py-2 text-xs uppercase tracking-[0.12em] font-mono transition-colors",
                        network === n.id
                          ? "border-court-ink bg-court-ink text-court-bg"
                          : "border-court-gray/60 bg-court-paper text-court-gray hover:text-court-ink hover:border-court-ink"
                      )}
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Address field */}
              <div>
                <label htmlFor="wallet-address" className="block text-[0.62rem] uppercase tracking-[0.18em] text-court-gray mb-2 font-mono">
                  Wallet Address of the Accused
                </label>
                <div className="flex items-center border-2 border-court-ink bg-court-paper focus-within:bg-court-bg transition-colors">
                  <span className="px-3 text-court-red font-mono text-sm select-none border-r border-court-gray/40">№</span>
                  <input
                    id="wallet-address"
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="enter the address of the accused…"
                    spellCheck={false}
                    autoComplete="off"
                    className="w-full bg-transparent py-3 pr-3 font-mono text-sm text-court-ink placeholder:text-court-gray/70 focus:outline-none"
                  />
                </div>
                {network === "solana" && (
                  <p className="mt-1.5 text-[0.62rem] text-court-gray font-mono">
                    Solana addresses are base58, 32–44 chars.
                  </p>
                )}
              </div>

              {/* Clerk notes / marginalia */}
              <div className="border-l-2 border-court-red/70 pl-3 space-y-1">
                {CLERK_NOTES.map((note) => (
                  <p key={note} className="text-[0.66rem] italic text-court-gray leading-snug">
                    {note}
                  </p>
                ))}
              </div>

              {error && (
                <div className="flex items-start gap-2 border-2 border-court-red bg-court-red/10 px-3 py-2 text-sm text-court-red">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span className="font-mono">{error}</span>
                </div>
              )}

              <button
                type="submit"
                className="group w-full inline-flex items-center justify-center gap-2 bg-court-ink text-court-bg font-display font-bold uppercase tracking-[0.18em] text-sm py-4 hover:bg-court-red transition-colors"
              >
                <Gavel className="h-4 w-4 group-hover:animate-gavel-strike" />
                Execute Subpoena
              </button>
              <p className="text-center text-[0.6rem] uppercase tracking-[0.15em] text-court-gray font-mono">
                No account required · No wallet connection · Verdicts are parody
              </p>
            </div>
          </div>
        </div>
      </form>

      <p className="mt-5 text-center text-[0.68rem] text-court-gray font-mono">
        Try the demo address{" "}
        <code className="text-court-red">0x71c000000000000000000000000000000000c4f1</code>{" "}
        — it always returns <span className="text-court-red">One Pump Chump</span>.
      </p>
    </section>
  );
}