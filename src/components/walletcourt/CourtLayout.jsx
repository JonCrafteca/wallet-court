import { useState } from "react";
import { Outlet, NavLink, Link } from "react-router-dom";
import { Menu, X, LogOut, LogIn } from "lucide-react";
import TickerTape from "./TickerTape";
import ShoutItMark from "./ShoutItMark";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { getNavItems } from "@/lib/routeState";

export default function CourtLayout() {
  const [open, setOpen] = useState(false);
  const { isAuthenticated, isLoadingAuth, logout } = useAuth();
  const navItems = getNavItems({ isAuthenticated, isLoadingAuth });
  // Safe internal returnTo for Sign In: current same-origin path, appended
  // as a query param. authReturnTo.safeReturnTo() sanitizes it on the Login
  // page side, rejecting external/protocol-relative/backslash URLs.
  const currentPath = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
  const signInTo = `/login?returnTo=${encodeURIComponent(currentPath)}`;

  function renderNavItem(item, isMobile) {
    if (item.type === "badge") {
      return (
        <span
          key="demo-badge"
          className={cn(
            "inline-flex items-center gap-1.5 border-2 border-court-chart bg-court-navy px-2 py-1 text-xs uppercase tracking-[0.18em] text-court-chart",
            isMobile ? "w-full justify-center" : "ml-2"
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-court-chart animate-blink" />
          {item.label}
        </span>
      );
    }
    if (item.type === "button") {
      return (
        <button
          key={item.label}
          type="button"
          onClick={() => { logout(); setOpen(false); }}
          className={cn(
            "inline-flex items-center gap-1.5 border-2 border-court-ice text-court-ice font-display uppercase tracking-[0.08em] hover:bg-court-red hover:border-court-red transition-colors",
            isMobile ? "w-full justify-center px-3 py-2.5 text-base" : "ml-2 px-2.5 py-1 text-xs"
          )}
        >
          <LogOut className={isMobile ? "h-5 w-5" : "h-3.5 w-3.5"} /> {item.label}
        </button>
      );
    }
    // link
    const to = item.label === "Sign In" ? signInTo : item.to;
    const isAuthItem = item.authRequired || item.label === "Sign In";
    return (
      <NavLink
        key={item.label}
        to={to}
        end={item.end}
        onClick={() => isMobile && setOpen(false)}
        className={({ isActive }) =>
          cn(
            "font-display uppercase tracking-[0.08em] border-2 transition-colors",
            isMobile
              ? "block px-3 py-2.5 text-base"
              : cn("px-3 py-1.5 text-sm", isAuthItem && "ml-2"),
            isActive
              ? "bg-court-chart text-court-navy border-court-chart"
              : isAuthItem
                ? "text-court-ice border-court-ice hover:bg-court-uv"
                : "text-court-ice border-transparent hover:border-court-ice"
          )
        }
      >
        {item.label === "Sign In" && !isMobile && <LogIn className="inline h-3.5 w-3.5 mr-1" />}
        {item.label}
      </NavLink>
    );
  }

  return (
    <div className="court-shell min-h-screen font-body relative overflow-x-hidden">
      <div className="fixed inset-0 broadcast-grid pointer-events-none" aria-hidden />
      <div className="relative z-10 flex min-h-screen flex-col">
        <header className="court-header sticky top-0 z-30 border-b-4">
          <div className="mx-auto max-w-6xl px-4 h-14 flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-3 min-w-0">
              <Link to="/" aria-label="Wallet Court home" className="font-display uppercase tracking-[0.04em] text-court-ice text-xl sm:text-2xl leading-none hover:text-court-chart transition-colors">
                Wallet Court
              </Link>
              <span className="hidden md:inline font-mono text-xs uppercase tracking-[0.22em] text-court-ice border-l border-court-mute pl-3">
                Nansen Evidence Division
              </span>
            </div>

            <nav className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => renderNavItem(item, false))}
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
              {navItems.map((item) => renderNavItem(item, true))}
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