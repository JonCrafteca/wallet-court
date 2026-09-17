import { useState } from "react";
import { Outlet, NavLink } from "react-router-dom";
import { Menu, X } from "lucide-react";
import TickerTape from "./TickerTape";
import ShoutItMark from "./ShoutItMark";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Courtroom", end: true },
  { to: "/hall", label: "The Hall" },
  { to: "/about", label: "About" },
];

export default function CourtLayout() {
  const [open, setOpen] = useState(false);

  return (
    <div className="court-shell min-h-screen font-body relative overflow-x-hidden">
      <div className="fixed inset-0 broadcast-grid pointer-events-none" aria-hidden />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="court-header sticky top-0 z-30 border-b-4">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="font-display uppercase tracking-[0.04em] text-court-ice text-xl sm:text-2xl leading-none">
                Wallet Court
              </span>
              <span className="hidden md:inline font-mono text-xs uppercase tracking-[0.22em] text-court-ice border-l border-court-mute pl-3">
                Nansen Evidence Division
              </span>
            </div>

            <nav className="hidden sm:flex items-center gap-1">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    cn(
                      "px-3 py-1.5 font-display uppercase tracking-[0.08em] text-sm border-2 transition-colors",
                      isActive
                        ? "bg-court-chart text-court-navy border-court-chart"
                        : "text-court-ice border-transparent hover:border-court-ice"
                    )
                  }
                >
                  {n.label}
                </NavLink>
              ))}
              <span className="ml-2 inline-flex items-center gap-1.5 border-2 border-court-chart bg-court-navy px-2 py-1 text-xs uppercase tracking-[0.18em] text-court-chart">
                <span className="h-1.5 w-1.5 rounded-full bg-court-chart animate-blink" />
                Demo
              </span>
            </nav>

            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label="Toggle navigation"
              className="sm:hidden inline-flex items-center justify-center border-2 border-court-ice text-court-ice p-2"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>

          {open && (
            <nav className="sm:hidden border-t-2 border-court-ice bg-court-navy px-4 py-3 space-y-2">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      "block px-3 py-2.5 font-display uppercase tracking-[0.08em] text-base border-2",
                      isActive
                        ? "bg-court-chart text-court-navy border-court-chart"
                        : "text-court-ice border-court-ice"
                    )
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
          )}

          <TickerTape />
        </header>

        <main className="flex-1">
          <Outlet />
        </main>

        <footer className="border-t-4 border-court-navy bg-court-navy px-4 py-4">
          <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="font-display uppercase tracking-[0.1em] text-court-ice text-sm">Wallet Court</span>
              <ShoutItMark variant="mascot" showTagline size={30} />
            </div>
            <span className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-court-chart">Evidence powered by Nansen</span>
            <span className="w-full sm:w-auto sm:text-right font-mono text-[0.6rem] uppercase tracking-[0.15em] text-court-mute">Verdicts are parody. Not financial advice. Roasts target behavior, never identity.</span>
          </div>
        </footer>
      </div>
    </div>
  );
}