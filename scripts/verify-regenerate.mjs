// Verification: Regenerate must produce a batch that differs from the
// immediately previous batch, and each style must expose 12 distinct drafts.
// Run: node scripts/verify-regenerate.mjs
import { buildDraft, buildDrafts } from "../src/lib/courtDispatch.js";

const trial = {
  public_slug: "case-test",
  data_mode: "demo",
  severity_score: 82,
  confidence_score: 88,
  verdict_name: "One Pump Chump",
  headline: "Arrived early. Finished earlier.",
  roast: "The stamina was the real crime.",
  defense_statement: "It was a one-time thing.",
};
const opts = { caseUrl: "https://example.com/case/case-test", xHandle: "" };

let failures = 0;
function assert(cond, msg) {
  if (!cond) { console.error("FAIL:", msg); failures++; }
  else console.log("pass:", msg);
}

for (const style of ["court_dispatch", "self_roast", "challenge_post"]) {
  const all = Array.from({ length: 12 }, (_, v) => buildDraft(trial, style, opts, v));
  assert(new Set(all).size === 12, `${style}: 12 distinct drafts`);

  // Simulate Regenerate: the base advances by 3 on each click.
  let base = 0;
  let prev = buildDrafts(trial, style, opts, base);
  for (let click = 1; click <= 6; click++) {
    base += 3;
    const next = buildDrafts(trial, style, opts, base);
    const overlap = prev.some((d) => next.includes(d));
    assert(!overlap, `${style}: regenerate click ${click} differs from previous batch`);
    prev = next;
  }
}

if (failures) { console.error(`\n${failures} assertion(s) failed`); process.exit(1); }
console.log("\nAll regenerate assertions passed.");