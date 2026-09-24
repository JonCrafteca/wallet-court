import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { Gavel, AlertTriangle, Twitter, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { base44 } from "@/api/base44Client";
import {
  shortAddr,
  buildChallengeUrl,
  buildResponsePost,
  xIntentUrl,
} from "@/lib/courtDispatch";
import { trackShare, SHARE_EVENTS } from "@/lib/shareAnalytics";
import { validateWalletForChain } from "@/lib/walletValidation";
import LoadingStage from "@/components/walletcourt/LoadingStage";
import { NETWORK_OPTIONS as NETWORKS } from "@/lib/chains";

export default function Challenge() {
  const { sourceCaseSlug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [phase, setPhase] = useState("loading");
  const [challenge, setChallenge] = useState(null);
  const [sourceTrial, setSourceTrial] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState("");

  const [network, setNetwork] = useState("ethereum");
  const [address, setAddress] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    let alive = true;
    const c = searchParams.get("c");
    (async () => {
      try {
        if (c) {
          const res = await base44.functions.invoke("getChallenge", { challenge_slug: c });
          if (!alive) return;
          if (res?.data?.error) {
            setError(res.data.error);
            setPhase("notfound");
            return;
          }
          const ch = res.data.challenge;
          setChallenge(ch);
          if (ch.status === "completed") {
            setComparison(ch);
            setPhase("comparison");
          } else {
            setPhase("form");
          }
        } else {
          const res = await base44.functions.invoke("getTrialBySlug", { slug: sourceCaseSlug });
          if (!alive) return;
          if (res?.data?.error) {
            setError(res.data.error);
            setPhase("notfound");
            return;
          }
          setSourceTrial(res.data.trial);
          setPhase("form");
        }
      } catch (e) {
        if (!alive) return;
        setError(e?.message || "Challenge could not be loaded.");
        setPhase("notfound");
      }
    })();
    return () => {
      alive = false;
    };
  }, [sourceCaseSlug, searchParams]);

  const challenger = challenge
    ? {
        address_short: challenge.challenger_address_short,
        verdict_name: challenge.challenger_verdict_name,
        severity: challenge.challenger_severity,
        confidence: challenge.challenger_confidence,
        network: challenge.challenger_network,
        data_mode: challenge.challenger_data_mode,
      }
    : sourceTrial
    ? {
        address_short: sourceTrial.address_short || shortAddr(sourceTrial.normalized_wallet_address || sourceTrial.wallet_address),
        verdict_name: sourceTrial.verdict_name,
        severity: sourceTrial.severity_score,
        confidence: sourceTrial.confidence_score,
        network: sourceTrial.network,
        data_mode: sourceTrial.data_mode,
      }
    : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError("");
    if (!address.trim()) {
      setFormError("A wallet address is required.");
      return;
    }
    const validation = validateWalletForChain(network, address.trim());
    if (!validation.ok) {
      setFormError(validation.message);
      return;
    }
    setPhase("analyzing");
    trackShare(SHARE_EVENTS.CHALLENGE_ACCEPTED);
    try {
      const [res] = await Promise.all([
        base44.functions.invoke("analyzeWalletWithNansen", {
          wallet_address: address.trim(),
          network,
        }),
        new Promise((r) => setTimeout(r, 2800)),
      ]);
      if (res?.data?.error) {
        setFormError(res.data.error);
        setPhase("form");
        return;
      }
      const defendant = res.data.trial;
      const compRes = await base44.functions.invoke("completeChallenge", {
        challenge_slug: challenge?.challenge_slug || null,
        source_case_slug: sourceCaseSlug,
        defendant_case_slug: defendant.public_slug,
      });
      if (compRes?.data?.error) {
        setFormError(compRes.data.error);
        setPhase("form");
        return;
      }
      const completed = compRes.data.challenge;
      setComparison(completed);
      setChallenge(completed);
      trackShare(SHARE_EVENTS.CHALLENGE_COMPLETED);
      setSearchParams({ c: completed.challenge_slug });
      setPhase("comparison");
    } catch (err) {
      setFormError(err?.message || "The court failed to convene.");
      setPhase("form");
    }
  }

  if (phase === "loading") return <LoadingStage visible />;
  if (phase === "analyzing") return <LoadingStage visible />;

  if (phase === "notfound") {
    return (
      <div className="mx-auto max-w-xl px-4 pt-20 pb-24">
        <div className="border-2 border-court-ice bg-court-navy p-6 sm:p-8 text-center">
          <p className="font-display uppercase text-court-red text-3xl mb-3 tracking-[0.04em]">Challenge not found</p>
          <p className="font-mono text-base text-court-ice mb-6 leading-relaxed">{error || "This summons never reached the docket."}</p>
          <Link to="/" className="inline-flex items-center justify-center bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-base px-6 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all">
            Take the Stand
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="mx-auto max-w-3xl px-4 pt-8 sm:pt-12 pb-20">
      <Link to={`/case/${sourceCaseSlug}`} className="inline-flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.12em] text-court-mute hover:text-court-chart mb-6">
        <ArrowLeft className="h-3.5 w-3.5" /> View original case
      </Link>

      {phase === "form" && challenger && (
        <>
          <div className="text-center mb-8">
            <h1 className="font-display uppercase leading-[0.86] text-court-ice" style={{ fontSize: "clamp(2.2rem, 6vw, 4rem)" }}>
              You Have Been Summoned
            </h1>
            <p className="mt-4 font-mono text-base text-court-ice max-w-xl mx-auto leading-relaxed">
              A wallet dared the court to rate their crimes against capital. Now it's your turn.
            </p>
          </div>

          <ChallengerCard challenger={challenger} />

          <form onSubmit={handleSubmit} className="mt-8 border-4 border-court-ice bg-court-navy shadow-[8px_8px_0_0_#5127C7]">
            <div className="border-b-2 border-court-ice bg-court-red px-4 py-2">
              <span className="font-display uppercase tracking-[0.1em] text-court-ice text-sm">Defendant Scanner · Onchain Division</span>
            </div>
            <div className="p-5 sm:p-7 space-y-5">
              <div>
                <label className="block font-mono text-xs uppercase tracking-[0.16em] text-court-mute mb-2">Select Network</label>
                <div className="grid grid-cols-3 gap-2">
                  {NETWORKS.map((n) => (
                    <button key={n.id} type="button" onClick={() => setNetwork(n.id)}
                      className={cn("border-2 px-3 py-3 font-display uppercase tracking-[0.06em] text-sm transition-colors",
                        network === n.id ? "bg-court-chart text-court-navy border-court-chart" : "bg-court-navy text-court-ice border-court-ice hover:bg-court-uv")}>
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="def-address" className="block font-mono text-xs uppercase tracking-[0.16em] text-court-mute mb-2">Your Wallet Address</label>
                <div className="flex items-center border-2 border-court-ice bg-court-navy focus-within:border-court-chart transition-colors">
                  <span className="px-3 text-court-red font-mono text-base select-none border-r border-court-mute">№</span>
                  <input id="def-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)}
                    placeholder="enter your wallet address…" spellCheck={false} autoComplete="off"
                    className="w-full bg-transparent py-3 pr-3 font-mono text-base text-court-ice placeholder:text-court-mute focus:outline-none" />
                </div>
              </div>
              {formError && (
                <div className="flex items-start gap-2 border-2 border-court-red bg-court-navy px-3 py-3 text-base text-court-red">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span className="font-mono leading-relaxed">{formError}</span>
                </div>
              )}
              <button type="submit" className="group w-full inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.12em] text-lg py-4 border-2 border-court-navy shadow-[5px_5px_0_0_#FF3B30] hover:shadow-none hover:translate-x-[5px] hover:translate-y-[5px] transition-all">
                <Gavel className="h-5 w-5 group-hover:animate-gavel-strike" /> Face the Court
              </button>
            </div>
          </form>
        </>
      )}

      {phase === "comparison" && comparison && (
        <ComparisonPanel comparison={comparison} sourceCaseSlug={sourceCaseSlug} />
      )}
    </section>
  );
}

function ChallengerCard({ challenger }) {
  const isLive = challenger.data_mode === "live";
  return (
    <div className="border-2 border-court-ice bg-court-navy p-5">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">The Challenger</p>
      <p className="font-display uppercase text-court-ice text-xl mb-3">{challenger.verdict_name}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm text-court-mute">
        <span className="text-court-ice">{challenger.address_short}</span>
        <span>{challenger.network}</span>
        <span>Sev {Math.round(challenger.severity || 0)}</span>
        <span>Conf {Math.round(challenger.confidence || 0)}%</span>
        <span className={isLive ? "text-court-chart" : "text-court-red"}>{isLive ? "Live · Nansen" : "Demo"}</span>
      </div>
    </div>
  );
}

function ComparisonPanel({ comparison, sourceCaseSlug }) {
  const url = buildChallengeUrl(sourceCaseSlug, comparison.challenge_slug);
  const responsePost = buildResponsePost(comparison, url);
  const aLive = comparison.challenger_data_mode === "live";
  const bLive = comparison.defendant_data_mode === "live";

  function shareComparison() {
    trackShare(SHARE_EVENTS.X_COMPOSER_OPENED);
    window.open(xIntentUrl(responsePost), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h1 className="font-display uppercase leading-[0.86] text-court-ice" style={{ fontSize: "clamp(2rem, 5.5vw, 3.5rem)" }}>
          The Court Has Seen Enough
        </h1>
      </div>

      <div className="border-2 border-court-chart bg-court-navy p-5 sm:p-6 text-center">
        <p className="font-display uppercase tracking-[0.06em] text-court-chart text-lg sm:text-2xl leading-tight">
          {comparison.result}
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <SideCard label="Challenger" data={comparison.challenger_verdict_name} addr={comparison.challenger_address_short} network={comparison.challenger_network} severity={comparison.challenger_severity} confidence={comparison.challenger_confidence} isLive={aLive} />
        <SideCard label="Defendant" data={comparison.defendant_verdict_name} addr={comparison.defendant_address_short} network={comparison.defendant_network} severity={comparison.defendant_severity} confidence={comparison.defendant_confidence} isLive={bLive} />
      </div>

      <div className="border-2 border-court-ice bg-court-navy p-5">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">Response Post</p>
        <p className="font-mono text-sm text-court-ice leading-relaxed whitespace-pre-wrap break-words mb-4">{responsePost}</p>
        <button type="button" onClick={shareComparison} className="inline-flex items-center justify-center gap-2 bg-court-chart text-court-navy font-display uppercase tracking-[0.1em] text-base px-4 py-3 border-2 border-court-navy shadow-[4px_4px_0_0_#FF3B30] hover:brightness-105 transition-all">
          <Twitter className="h-5 w-5" /> Share Comparison
        </button>
      </div>

      <p className="font-mono text-xs text-court-mute leading-relaxed text-center">
        This playful comparison is not investment advice. Severity and confidence come from Wallet Court's verdict engine.
      </p>
    </div>
  );
}

function SideCard({ label, data, addr, network, severity, confidence, isLive }) {
  return (
    <div className="border-2 border-court-ice bg-court-navy p-5">
      <p className="font-mono text-xs uppercase tracking-[0.14em] text-court-mute mb-2">{label}</p>
      <p className="font-display uppercase text-court-ice text-xl mb-3">{data}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-sm text-court-mute">
        <span className="text-court-ice">{addr}</span>
        <span>{network}</span>
        <span>Sev {Math.round(severity || 0)}</span>
        <span>Conf {Math.round(confidence || 0)}%</span>
        <span className={isLive ? "text-court-chart" : "text-court-red"}>{isLive ? "Live · Nansen" : "Demo"}</span>
      </div>
    </div>
  );
}