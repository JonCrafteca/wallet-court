import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Check, X, Eye, EyeOff, Loader2, FileText } from "lucide-react";
import { getDefenseQueue, moderateDefense } from "@/lib/walletClaim";
import { cn } from "@/lib/utils";

const STATUS_COLORS = {
  pending: "text-court-mute border-court-mute",
  approved: "text-court-chart border-court-chart",
  rejected: "text-court-red border-court-red",
  hidden: "text-court-mute border-court-mute"
};

export default function AdminDefenses() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [defenses, setDefenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("pending");
  const [acting, setActing] = useState({});
  const [note, setNote] = useState({});

  useEffect(() => {
    (async () => {
      try { setUser(await base44.auth.me()); } catch { setUser(null); }
      finally { setAuthChecked(true); }
    })();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await getDefenseQueue(filter);
      if (res?.error) { setError(res.error); setDefenses([]); }
      else setDefenses(res.defenses || []);
    } catch (e) {
      setError(e?.message || "Failed to load defenses.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authChecked && user?.role === "admin") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user, filter]);

  async function act(id, action) {
    setActing((a) => ({ ...a, [id]: true }));
    try {
      const res = await moderateDefense(id, action, note[id]);
      if (res?.error) { setError(res.error); }
      else { load(); }
    } catch (e) {
      setError(e?.message || "Action failed.");
    } finally {
      setActing((a) => ({ ...a, [id]: false }));
    }
  }

  if (!authChecked) return <div className="mx-auto max-w-4xl px-4 pt-20 text-center"><Loader2 className="h-6 w-6 animate-spin text-court-chart mx-auto" /></div>;
  if (user?.role !== "admin") {
    return <div className="mx-auto max-w-xl px-4 pt-20 text-center"><p className="font-display uppercase text-court-red text-2xl">Admin access required.</p></div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pt-8 pb-20">
      <h1 className="font-display uppercase tracking-[0.04em] text-court-ice text-3xl mb-2">Official Defense Moderation</h1>
      <p className="font-mono text-sm text-court-mute mb-6">Review owner-submitted defenses before they appear publicly.</p>

      <div className="flex gap-2 mb-4">
        {["pending", "approved", "rejected", "hidden", "all"].map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={cn("font-mono text-xs uppercase tracking-[0.1em] px-3 py-1.5 border-2", filter === s ? "bg-court-chart text-court-navy border-court-chart" : "text-court-ice border-court-ice hover:bg-court-uv")}>
            {s}
          </button>
        ))}
      </div>

      {error && <div className="border-2 border-court-red bg-court-navy p-3 font-mono text-sm text-court-red mb-4">{error}</div>}

      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-court-chart" />
      ) : defenses.length === 0 ? (
        <p className="font-mono text-sm text-court-mute">No defenses in this state.</p>
      ) : (
        <div className="space-y-3">
          {defenses.map((d) => (
            <div key={d.id} className="border-2 border-court-ice bg-court-navy p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-mono text-xs text-court-mute">v{d.version} · {d.claim_slug}</span>
                <span className={cn("font-mono text-[0.65rem] uppercase tracking-[0.1em] px-1.5 py-0.5 border", STATUS_COLORS[d.moderation_status])}>{d.moderation_status}</span>
              </div>
              <p className="font-mono text-sm text-court-ice leading-relaxed whitespace-pre-wrap mb-3">{d.text}</p>
              <p className="font-mono text-xs text-court-mute mb-3">Submitted {new Date(d.submitted_at).toLocaleString()}</p>
              {d.moderation_status === "pending" && (
                <>
                  <input
                    value={note[d.id] || ""}
                    onChange={(e) => setNote((n) => ({ ...n, [d.id]: e.target.value }))}
                    placeholder="Optional moderation note (admin-only)"
                    className="w-full court-input px-3 py-2 font-mono text-xs mb-2"
                  />
                  <div className="flex gap-2">
                    <button onClick={() => act(d.id, "approve")} disabled={acting[d.id]} className="inline-flex items-center gap-1 bg-court-chart text-court-navy font-display uppercase tracking-[0.06em] text-xs px-3 py-2 border-2 border-court-navy disabled:opacity-60">
                      {acting[d.id] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                    </button>
                    <button onClick={() => act(d.id, "reject")} disabled={acting[d.id]} className="inline-flex items-center gap-1 bg-court-red text-court-ice font-display uppercase tracking-[0.06em] text-xs px-3 py-2 border-2 border-court-ice disabled:opacity-60">
                      <X className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                </>
              )}
              {d.moderation_status === "approved" && (
                <button onClick={() => act(d.id, "hide")} disabled={acting[d.id]} className="inline-flex items-center gap-1 font-mono text-xs uppercase tracking-[0.08em] text-court-red hover:text-court-ice disabled:opacity-50">
                  <EyeOff className="h-3.5 w-3.5" /> Hide
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}