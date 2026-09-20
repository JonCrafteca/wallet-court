export default function AccountOverview({ counts }) {
  const items = [
    { label: "Trials Submitted", value: counts.trials, color: "text-court-ice" },
    { label: "Verdicts", value: counts.verdicts, color: "text-court-chart" },
    { label: "Case Dismissals", value: counts.dismissals, color: "text-court-mute" },
    { label: "Mistrials", value: counts.mistrials, color: "text-court-red" },
    { label: "Verified Wallets", value: counts.verified_wallets, color: "text-court-chart" },
    { label: "Official Defenses", value: counts.defenses, color: "text-court-ice" },
    { label: "Summons", value: counts.summons || 0, color: "text-court-chart" }
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {items.map((item) => (
        <div key={item.label} className="border-2 border-court-ice bg-court-navy p-4">
          <p className={`font-display text-3xl sm:text-4xl ${item.color}`}>{item.value}</p>
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute mt-1">{item.label}</p>
        </div>
      ))}
    </div>
  );
}