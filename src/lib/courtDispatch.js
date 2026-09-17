import { SHOUTIT_X_HANDLE, X_CHAR_LIMIT } from "./shareConfig";

export function buildCaseUrl(slug) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/case/${slug}`;
}

export function buildChallengeUrl(sourceCaseSlug, challengeSlug) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/challenge/${sourceCaseSlug}?c=${challengeSlug}`;
}

export function shortAddr(addr) {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function lowerFirst(s) {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function roastFirst(roast) {
  if (!roast) return "";
  const s = roast.split(/[.!?]/)[0];
  return s ? s + "." : roast;
}

function evidenceLine(isLive) {
  return isLive ? "Evidence powered by @nansen_ai" : "Demo case";
}

// Build a single draft for a given style and variation index (0-2). Variations
// rotate through phrasing pools so regeneration yields distinct, deterministic
// options drawn from the actual case data.
export function buildDraft(trial, style, opts = {}, v = 0) {
  const caseUrl = opts.caseUrl || buildCaseUrl(trial.public_slug);
  const xHandle = opts.xHandle ? `@${opts.xHandle} ` : "";
  const isLive = trial.data_mode === "live";
  const sev = Math.round(trial.severity_score || 0);
  const conf = Math.round(trial.confidence_score || 0);
  const vname = (trial.verdict_name || "GUILTY").toUpperCase();
  const headline = trial.headline || "";
  const roast = trial.roast || "";
  const defense = trial.defense_statement || "";
  const evLine = evidenceLine(isLive);
  const i = ((v % 3) + 3) % 3;

  if (style === "court_dispatch") {
    const intros = [
      `${xHandle}put their wallet on trial.`,
      `${xHandle}stood before Wallet Court.`,
      `${xHandle}took the stand.`,
    ];
    const bodies = [
      `VERDICT: ${vname}\n${headline}`,
      `The court ruled: ${vname}.\n${headline}`,
      `GUILTY of being a ${vname}.\n${headline}`,
    ];
    return [
      "🚨 COURT DISPATCH",
      "",
      intros[i],
      "",
      bodies[i],
      "",
      `Severity: ${sev}/100`,
      `Confidence: ${conf}%`,
      evLine,
      "",
      `View the case: ${caseUrl}`,
    ].join("\n");
  }

  if (style === "self_roast") {
    const openings = [
      "I voluntarily put my wallet on trial.",
      "I turned myself in to Wallet Court.",
      "I handed my wallet to the court.",
    ];
    const middles = [
      `The court found me guilty of being a ${vname}.`,
      `Verdict: ${vname}.`,
      `The court ruled I'm a ${vname}.`,
    ];
    const closes = [
      defense ? `In my defense, ${lowerFirst(defense)}` : roastFirst(roast),
      defense ? `My defense: ${lowerFirst(defense)}` : roastFirst(roast),
      roast ? roastFirst(roast) : `In my defense, ${lowerFirst(defense)}`,
    ];
    return [
      openings[i],
      "",
      middles[i],
      "",
      closes[i],
      "",
      `Try your wallet: ${caseUrl}`,
    ].join("\n");
  }

  // challenge_post
  const challengeUrl = opts.challengeUrl || caseUrl;
  const rawHandles = (opts.challengeHandles || []).filter(Boolean);
  const handles = rawHandles.map((h) => (h.startsWith("@") ? h : `@${h}`)).join(", ");
  const intros = [
    `I survived Wallet Court with a severity score of ${sev}.`,
    `Wallet Court gave me a severity of ${sev}. I lived.`,
    `The court rated my wallet ${sev}/100. I'm still standing.`,
  ];
  const calls = [
    `${handles || "@friends"} — put your wallets where your mouths are.`,
    `${handles || "@friends"}, your turn. Put your wallets on trial.`,
    `I nominate ${handles || "friends"} to face the court.`,
  ];
  return [
    intros[i],
    "",
    calls[i],
    "",
    "Who committed greater crimes against capital?",
    "",
    `Accept the challenge: ${challengeUrl}`,
  ].join("\n");
}

export function buildDrafts(trial, style, opts = {}) {
  return [0, 1, 2].map((v) => buildDraft(trial, style, opts, v));
}

// Response post shown after a challenge is completed.
export function buildResponsePost(challenge, url) {
  const handles = safeParseHandles(challenge.challenged_handles_json);
  const challengerTag = handles.length ? handles.map((h) => `@${h}`).join(", ") : challenge.challenger_address_short || "A wallet";
  const a = challenge.challenger_verdict_name || "—";
  const b = challenge.defendant_verdict_name || "—";
  const aSev = Math.round(challenge.challenger_severity || 0);
  const bSev = Math.round(challenge.defendant_severity || 0);
  return [
    `${challengerTag} summoned another wallet to court.`,
    "",
    "The defendant accepted.",
    "",
    `${a} — Severity ${aSev}`,
    `${b} — Severity ${bSev}`,
    "",
    "The court has seen enough.",
    "",
    `View the comparison: ${url}`,
  ].join("\n");
}

export function xIntentUrl(text) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function charCount(text) {
  return (text || "").length;
}

export function overXLimit(text) {
  return charCount(text) > X_CHAR_LIMIT;
}

function safeParseHandles(s) {
  try {
    return JSON.parse(s) || [];
  } catch {
    return [];
  }
}