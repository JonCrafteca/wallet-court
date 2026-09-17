import { Gavel, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function IntakeStage({ network, setNetwork, networks, address, setAddress, onSubmit, error }) {
  return (
    <section className="mx-auto max-w-3xl px-4 pt-10 sm:pt-16 pb-24">
      {/* Hero arrival */}
      <div className="text-center mb-8 sm:mb-12">
        <p className="text-[0.7rem] uppercase tracking-[0.3em] text-court-gold mb-4">
          Case File · WC-0001
        </p>
        <h1
          className="font-display font-black uppercase leading-[0.95] text-court-text"
          style={{ fontSize: "clamp(2.5rem, 6vw, 4.5rem)" }}
        >
          Your Wallet Has Been<br className="hidden sm:block" /> Subpoenaed.
        </h1>
        <p className="mt-5 text-sm sm:text-base text-muted-foreground max-w-xl mx-auto">
          Nansen provides the onchain evidence. Wallet Court delivers the verdict.
        </p>
      </div>

      {/* Formal Summons intake */}
      <form
        onSubmit={onSubmit}
        className="border border-court-line bg-court-surface relative"
      >
        <div className="border-b border-court-line px-4 py-2 flex items-center justify-between text-[0.6rem] uppercase tracking-[0.2em] text-muted-foreground">
          <span>Formal Summons · Onchain Division</span>
          <span className="text-court-gold">PUBLIC FILING</span>
        </div>

        <div className="p-4 sm:p-6 space-y-5">
          {/* Network selector */}
          <div>
            <label className="block text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Select Network
            </label>
            <div className="grid grid-cols-3 gap-2">
              {networks.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => setNetwork(n.id)}
                  className={cn(
                    "border px-3 py-2 text-xs uppercase tracking-[0.12em] transition-colors",
                    network === n.id
                      ? "border-court-gold bg-court-gold/10 text-court-gold"
                      : "border-court-line text-muted-foreground hover:text-court-text hover:border-court-text/40"
                  )}
                >
                  {n.label}
                </button>
              ))}
            </div>
          </div>

          {/* Address field */}
          <div>
            <label htmlFor="wallet-address" className="block text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground mb-2">
              Wallet Address
            </label>
            <div className="flex items-center border border-court-line bg-court-bg focus-within:border-court-gold transition-colors">
              <span className="px-3 text-court-gold font-mono text-sm select-none">0x·</span>
              <input
                id="wallet-address"
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="enter the address of the accused…"
                spellCheck={false}
                autoComplete="off"
                className="w-full bg-transparent py-3 pr-3 font-mono text-sm text-court-text placeholder:text-muted-foreground/60 focus:outline-none"
              />
            </div>
            {network === "solana" && (
              <p className="mt-1.5 text-[0.65rem] text-muted-foreground">
                Solana addresses are base58, 32–44 chars. The 0x· prefix is decorative.
              </p>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 border border-court-red/50 bg-court-red/10 px-3 py-2 text-sm text-court-red">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="group w-full inline-flex items-center justify-center gap-2 bg-court-gold text-court-bg font-display font-bold uppercase tracking-[0.18em] text-sm py-4 hover:brightness-110 transition"
          >
            <Gavel className="h-4 w-4 group-hover:animate-gavel-strike" />
            Execute Subpoena
          </button>
          <p className="text-center text-[0.65rem] uppercase tracking-[0.15em] text-muted-foreground">
            No account required · No wallet connection · Verdicts are parody
          </p>
        </div>
      </form>

      <p className="mt-6 text-center text-[0.7rem] text-muted-foreground">
        Try the demo address{" "}
        <code className="text-court-gold font-mono">0x71c000000000000000000000000000000000c4f1</code>{" "}
        — it always returns <span className="text-court-gold">One Pump Chump</span>.
      </p>
    </section>
  );
}