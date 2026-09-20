import { User, Users, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const SUBJECTS = [
  {
    id: "my_wallet",
    label: "My Wallet",
    desc: "After the verdict, verify ownership to claim your Rap Sheet.",
    icon: User,
  },
  {
    id: "someone_else",
    label: "Someone Else",
    desc: "Nominate a defendant and serve them a summons on X.",
    icon: Users,
  },
  {
    id: "anonymous",
    label: "Anonymous Wallet",
    desc: "Put the wallet on trial with no one named.",
    icon: HelpCircle,
  },
];

export default function TrialSubjectSelector({ value, onChange }) {
  return (
    <div>
      <label className="block font-mono text-xs uppercase tracking-[0.16em] text-court-mute mb-2">
        Who are we putting on trial?
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {SUBJECTS.map((s) => {
          const Icon = s.icon;
          const active = value === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onChange(s.id)}
              aria-pressed={active}
              className={cn(
                "text-left p-3 border-2 transition-colors",
                active
                  ? "bg-court-chart text-court-navy border-court-chart shadow-[3px_3px_0_0_#FF3B30]"
                  : "bg-court-navy text-court-ice border-court-ice hover:bg-court-uv"
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className={cn("h-4 w-4", active ? "text-court-navy" : "text-court-chart")} />
                <span className="font-display uppercase tracking-[0.06em] text-sm">{s.label}</span>
              </div>
              <p className={cn("font-mono text-xs leading-relaxed", active ? "text-court-navy" : "text-court-mute")}>
                {s.desc}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}