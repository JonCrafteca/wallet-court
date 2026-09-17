import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { cn } from "@/lib/utils";
import { AlertTriangle, ExternalLink, Check, X, Globe } from "lucide-react";
import VerdictCardPreview from "@/components/walletcourt/VerdictCardPreview";

const STATUS_OPTIONS = ["", "pending", "approved", "rejected", "published"];
const MODE_OPTIONS = ["", "demo", "live"];
const TYPE_OPTIONS = ["", "court_dispatch", "self_roast", "challenge_post"];

export default function AdminCourtDispatches() {
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ status: "", verdict_name: "", data_mode: "", submission_type: "" });
  const [previewSlug, setPreviewSlug] = useState(null);
  const [previewTrial, setPreviewTrial] = useState(null);
  const [publishUrl, setPublishUrl] = useState({});
  const [acting, setActing] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const me = await base44.auth.me();
        setUser(me);
      } catch {
        setUser(null);
      } finally {
        setAuthChecked(true);
      }
    })();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await base44.functions.invoke("getSubmissions", {
        status: filters.status || undefined,
        verdict_name: filters.verdict_name || undefined,
        data_mode: filters.data_mode || undefined,
        submission_type: filters.submission_type || undefined,
      });
      if (res?.data?.error) {
        setError(res.data.error);
        setSubmissions([]);
      } else {
        setSubmissions(res.data.submissions || []);
      }
    } catch (e) {
      setError(e?.message || "Failed to load submissions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authChecked && user?.role === "admin") load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authChecked, user]);

  async function act(id, action, extra) {
    setActing((a) => ({ ...a, [id]: true }));
    try {
      const res = await base44.functions.invoke("updateSubmission", {
        id,
        action,
        published_post_url: extra?.published_post_url,
      });
      if (res?.data?.error) {
        setError(res.data.error);
      } else {
        load();
      }
    } catch (e) {
      setError(e?.message || "Update failed.");
    } finally {
      setActing((a) => ({ ...a, [id]: false }));
    }
  }

  async function togglePreview(s) {
    if (previewSlug === s.id) {
      setPreviewSlug(null);
      setPreviewTrial(null);
      return;
    }
    setPreviewSlug(s.id);
    setPreviewTrial(null);
    try {
      const res = await base44.functions.invoke("getTrialBySlug", { slug: s.case_slug });
      if (!res?.data?.error) setPreviewTrial(res.data.trial);
    } catch {
      // ignore
    }
  }

  if (!authChecked) {
    return <div className="mx-auto max-w-md px-4 pt-24 text-center font-mono text-base text-court-ice animate-blink">Checking credentials…</div>;
  }
  if (!user) {
    return <AccessDenied message="Sign in to access the Court Desk." />;
  }
  if (user.role !== "admin") {
    return <AccessDenied message="Admin access required." />;
  }

  return (
    <section className="mx-auto max-w-5xl px-4 pt-8 sm:pt-12 pb-20">
      <header className="mb-6">
        <h1 className="font-display uppercase leading-[0.86] text-court-ice" style={{ fontSize: "clamp(1.8rem, 4vw, 2.8rem)" }}>
          Court Desk
        </h1>
        <p className="mt-2 font-mono text-base text-court-ice leading-relaxed">Editorial review of ShoutIt Court Dispatch submissions.</p>
      </header>

      {/* Filters */}
      <div className="grid sm:grid-cols-4 gap-2 mb-6">
        <FilterSelect label="Status" value={filters.status} options={STATUS_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, status: v }))} />
        <FilterSelect label="Mode" value={filters.data_mode} options={MODE_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, data_mode: v }))} />
        <FilterSelect label="Type" value={filters.submission_type} options={TYPE_OPTIONS} onChange={(v) => setFilters((f) => ({ ...f, submission_type: v }))} />
        <div>
          <label className="block font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-1.5">Verdict</label>
          <input
            type="text"
            value={filters.verdict_name}
            onChange={(e) => setFilters((f) => ({ ...f, verdict_name: e.target.value }))}
            placeholder="verdict name"
            className="w-full border-2 border-court-ice bg-court-navy px-2 py-2 font-mono text-sm text-court-ice placeholder:text-court-mute focus:border-court-chart focus:outline-none"
          />
        </div>
      </div>
      <button type="button" onClick={load} className="mb-6 inline-flex items-center justify-center bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-sm px-4 py-2 border-2 border-court-navy hover:brightness-105 transition-all">
        Apply Filters
      </button>

      {error && (
        <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-4 py-3 text-sm text-court-red mb-4">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="font-mono leading-relaxed">{error}</span>
        </div>
      )}

      {loading ? (
        <p className="font-mono text-base text-court-ice animate-blink">Loading docket…</p>
      ) : submissions.length === 0 ? (
        <p className="font-mono text-base text-court-mute">No submissions match these filters.</p>
      ) : (
        <div className="space-y-4">
          {submissions.map((s) => (
            <div key={s.id} className="border-2 border-court-ice bg-court-navy p-4">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className={cn("font-mono text-xs uppercase tracking-[0.12em] px-2 py-1 border-2", s.data_mode === "live" ? "border-court-chart text-court-chart" : "border-court-red text-court-red")}>
                  {s.data_mode === "live" ? "Live · Nansen" : "Demo"}
                </span>
                <span className="font-mono text-xs uppercase tracking-[0.12em] text-court-mute">{s.submission_type.replace("_", " ")}</span>
                <span className="font-display uppercase text-court-ice text-base">{s.verdict_name}</span>
                <span className="font-mono text-xs text-court-mute">{s.network}</span>
                <span className="ml-auto font-mono text-xs uppercase tracking-[0.12em] text-court-chart">{s.status}</span>
              </div>

              <p className="font-mono text-sm text-court-ice leading-relaxed whitespace-pre-wrap break-words mb-3 border-l-2 border-court-mute pl-3">
                {s.approved_post_text}
              </p>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-court-mute mb-3">
                <span>Handle: {s.optional_x_handle ? `@${s.optional_x_handle}` : "—"}</span>
                <span>Submitted: {s.submitted_at ? new Date(s.submitted_at).toLocaleString() : "—"}</span>
                <span>Case: {s.case_slug}</span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => togglePreview(s)} className="inline-flex items-center gap-1.5 bg-court-uv text-court-ice font-mono text-xs uppercase tracking-[0.1em] px-3 py-2 border-2 border-court-ice hover:brightness-110 transition-all">
                  {previewSlug === s.id ? "Hide Card" : "Preview Card"}
                </button>
                <Link to={`/case/${s.case_slug}`} className="inline-flex items-center gap-1.5 bg-court-navy text-court-ice font-mono text-xs uppercase tracking-[0.1em] px-3 py-2 border-2 border-court-ice hover:bg-court-uv transition-colors">
                  <ExternalLink className="h-3.5 w-3.5" /> Open Case
                </Link>
                {s.status !== "approved" && s.status !== "published" && (
                  <button type="button" disabled={acting[s.id]} onClick={() => act(s.id, "approve")} className="inline-flex items-center gap-1.5 bg-court-chart text-court-navy font-mono text-xs uppercase tracking-[0.1em] px-3 py-2 border-2 border-court-navy hover:brightness-105 transition-all disabled:opacity-60">
                    <Check className="h-3.5 w-3.5" /> Approve
                  </button>
                )}
                {s.status !== "rejected" && (
                  <button type="button" disabled={acting[s.id]} onClick={() => act(s.id, "reject")} className="inline-flex items-center gap-1.5 bg-court-red text-court-ice font-mono text-xs uppercase tracking-[0.1em] px-3 py-2 border-2 border-court-ice hover:brightness-105 transition-all disabled:opacity-60">
                    <X className="h-3.5 w-3.5" /> Reject
                  </button>
                )}
                {s.status === "approved" || s.status === "published" ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="url"
                      value={publishUrl[s.id] || s.published_post_url || ""}
                      onChange={(e) => setPublishUrl((p) => ({ ...p, [s.id]: e.target.value }))}
                      placeholder="X post URL"
                      className="border-2 border-court-ice bg-court-navy px-2 py-2 font-mono text-xs text-court-ice placeholder:text-court-mute focus:border-court-chart focus:outline-none w-56"
                    />
                    <button type="button" disabled={acting[s.id]} onClick={() => act(s.id, "publish", { published_post_url: publishUrl[s.id] || s.published_post_url })} className="inline-flex items-center gap-1.5 bg-court-chart text-court-navy font-mono text-xs uppercase tracking-[0.1em] px-3 py-2 border-2 border-court-navy hover:brightness-105 transition-all disabled:opacity-60">
                      <Globe className="h-3.5 w-3.5" /> Mark Published
                    </button>
                  </div>
                ) : null}
              </div>

              {previewSlug === s.id && (
                <div className="mt-4">
                  {previewTrial ? (
                    <VerdictCardPreview trial={previewTrial} className="w-full max-w-md border-2 border-court-ice" />
                  ) : (
                    <p className="font-mono text-sm text-court-mute animate-blink">Loading card…</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <div>
      <label className="block font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border-2 border-court-ice bg-court-navy px-2 py-2 font-mono text-sm text-court-ice focus:border-court-chart focus:outline-none"
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-court-navy text-court-ice">{o || "Any"}</option>
        ))}
      </select>
    </div>
  );
}

function AccessDenied({ message }) {
  return (
    <div className="mx-auto max-w-xl px-4 pt-20 pb-24">
      <div className="border-2 border-court-red bg-court-navy p-6 sm:p-8 text-center">
        <p className="font-display uppercase text-court-red text-3xl mb-3 tracking-[0.04em]">Restricted</p>
        <p className="font-mono text-base text-court-ice mb-6 leading-relaxed">{message}</p>
        <Link to="/" className="inline-flex items-center justify-center bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all">
          Back to Court
        </Link>
      </div>
    </div>
  );
}