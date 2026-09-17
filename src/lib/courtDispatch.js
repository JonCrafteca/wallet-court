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

// Build a single draft for a given style and variation index. Each style has
// 12 distinct, deterministic templates built ONLY from real case data — no
// invented evidence, scores, transactions, or claims. Regenerate advances the
// variation base by 3, so consecutive batches draw from disjoint template
// indices (12 templates, step 3 → 4 batches/cycle) and never repeat the
// immediately previous batch.
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
  const i = ((v % 12) + 12) % 12;

  if (style === "court_dispatch") {
    const openers = [
      `${xHandle}put their wallet on trial.`,
      `${xHandle}stood before Wallet Court.`,
      `${xHandle}took the stand.`,
      `${xHandle}faced the onchain evidence.`,
      `${xHandle}went before the bench.`,
      `${xHandle}let the court decide.`,
      `${xHandle}answered the summons.`,
      `${xHandle}let Nansen do the talking.`,
      `${xHandle}had their wallet subpoenaed.`,
      `${xHandle}stood trial for crimes against capital.`,
      `${xHandle}let the verdict speak.`,
      `${xHandle}went on the record.`,
    ];
    const rulings = [
      `VERDICT: ${vname}\n${headline}`,
      `The court ruled: ${vname}.\n${headline}`,
      `GUILTY of being a ${vname}.\n${headline}`,
      `Charged: ${vname}.\n${headline}`,
      `The jury returned: ${vname}.\n${headline}`,
      `Onchain verdict: ${vname}.\n${headline}`,
      `Case closed: ${vname}.\n${headline}`,
      `The bench found: ${vname}.\n${headline}`,
      `Verdict entered: ${vname}.\n${headline}`,
      `Ruled ${vname}.\n${headline}`,
      `The court's finding: ${vname}.\n${headline}`,
      `Judgment: ${vname}.\n${headline}`,
    ];
    return [
      "🚨 COURT DISPATCH",
      "",
      openers[i],
      "",
      rulings[i],
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
      "I pleaded guilty to crimes against capital.",
      "I let Wallet Court audit my onchain shame.",
      "I took the stand against myself.",
      "I submitted my wallet to judgment.",
      "I called the court on myself.",
      "I let Nansen testify against me.",
      "I stood accused by my own wallet.",
      "I waived my right to a defense.",
      "I put my own bag on trial.",
    ];
    const middles = [
      `The court found me guilty of being a ${vname}.`,
      `Verdict: ${vname}.`,
      `The court ruled I'm a ${vname}.`,
      `I was convicted of being a ${vname}.`,
      `The bench declared me a ${vname}.`,
      `Onchain verdict: ${vname}.`,
      `The jury found me a ${vname}.`,
      `Case closed: I'm a ${vname}.`,
      `Judgment: ${vname}.`,
      `The court entered ${vname}.`,
      `Ruled: ${vname}.`,
      `The finding: ${vname}.`,
    ];
    const closes = [
      defense ? `In my defense, ${lowerFirst(defense)}` : roastFirst(roast),
      defense ? `My defense: ${lowerFirst(defense)}` : roastFirst(roast),
      roast ? roastFirst(roast) : (defense ? `In my defense, ${lowerFirst(defense)}` : ""),
      defense ? `My excuse: ${lowerFirst(defense)}` : roastFirst(roast),
      roast ? roastFirst(roast) : (defense ? `My defense: ${lowerFirst(defense)}` : ""),
      defense ? `For the record: ${lowerFirst(defense)}` : roastFirst(roast),
      roast ? roastFirst(roast) : (defense ? `In my defense, ${lowerFirst(defense)}` : ""),
      defense ? `I argued: ${lowerFirst(defense)}` : roastFirst(roast),
      defense ? `My defense: ${lowerFirst(defense)}` : roastFirst(roast),
      roast ? roastFirst(roast) : (defense ? `For the record: ${lowerFirst(defense)}` : ""),
      defense ? `In my defense, ${lowerFirst(defense)}` : roastFirst(roast),
      defense ? `My defense: ${lowerFirst(defense)}` : roastFirst(roast),
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
    `I walked out of Wallet Court with severity ${sev}.`,
    `Severity ${sev}/100. I'm still free.`,
    `The bench handed me ${sev}/100 and I survived.`,
    `I took a ${sev}/100 verdict and kept my composure.`,
    `Wallet Court scored me ${sev}. Still here.`,
    `I faced the court and earned severity ${sev}.`,
    `The court gave me ${sev}/100. I'm not done.`,
    `Severity ${sev}. The court has spoken. I have not.`,
    `I left Wallet Court with a ${sev}/100 and my dignity.`,
  ];
  const calls = [
    `${handles || "@friends"} — put your wallets where your mouths are.`,
    `${handles || "@friends"}, your turn. Put your wallets on trial.`,
    `I nominate ${handles || "friends"} to face the court.`,
    `${handles || "@friends"}: think you did better? Prove it.`,
    `Your move, ${handles || "@friends"}. Face the court.`,
    `I dare ${handles || "friends"} to take the stand.`,
    `${handles || "@friends"} — subpoena your own wallet.`,
    `Who's braver, ${handles || "@friends"}? Take the stand.`,
    `${handles || "@friends"}, the court is waiting.`,
    `I'm calling out ${handles || "friends"}. Answer the summons.`,
    `${handles || "@friends"} — let the court rate your crimes.`,
    `Step up, ${handles || "@friends"}. The bench is open.`,
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

export function buildDrafts(trial, style, opts = {}, base = 0) {
  return [0, 1, 2].map((off) => buildDraft(trial, style, opts, base + off));
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