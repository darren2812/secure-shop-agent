import { useEffect, useState } from "react";
import { Orb } from "../orb/Orb";
import { OrbLabel } from "../orb/OrbLabel";
import { TIER_LABEL } from "../orb/colors";
import { useOrbStore } from "../orb/store";
import type { Reason, ResultTier } from "../api";

interface Scenario { name: string; description: string }
interface AttackResult {
  scenario: string;
  description: string;
  request_id: string;
  listing: { id: string; title: string; price: number };
  before: { tier: ResultTier; score: number } | null;
  after: { tier: ResultTier; score: number; reasons: Reason[]; store: { name: string; domain: string };
           untrusted_text: { listing_title: string; policy_text: string } };
}

/** Live attacks against the agent. Same scoring code as the home page; the orb shows the server verdict. */
export function Attack() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [result, setResult] = useState<AttackResult | null>(null);
  const [busy, setBusy] = useState(false);
  const { setTier, setAgentState, setLabel } = useOrbStore.getState();

  useEffect(() => {
    fetch("/api/attacks").then((r) => r.json()).then(setScenarios);
    setTier(null);
    setLabel("Pick an attack");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (name: string) => {
    setBusy(true);
    setResult(null);
    setTier(null);
    setAgentState("scanning");
    setLabel("Attacker is changing the data…");
    try {
      const r: AttackResult = await fetch(`/api/attacks/${name}`, { method: "POST" }).then((x) => x.json());
      setResult(r);
      setTier(r.after.tier);
      setLabel(`${r.after.store.name}: ${r.after.reasons[0]?.text ?? "no risk signals"}`);
    } finally {
      setAgentState("idle");
      setBusy(false);
    }
  };

  const reset = async () => {
    await fetch("/api/reset_demo", { method: "POST" });
    setResult(null);
    setTier(null);
    setLabel("Demo data reset");
  };

  const size = Math.max(220, Math.min(280, window.innerWidth - 80));
  return (
    <main className="page attack">
      <header className="lab__head">
        <h1>Attack the agent</h1>
        <a href="#/">home</a>
      </header>
      <section className="lab__stage">
        <Orb size={size} />
        <OrbLabel />
      </section>

      <div className="attack__grid">
        {scenarios.map((s) => (
          <button key={s.name} type="button" disabled={busy} onClick={() => run(s.name)}>
            {s.description}
          </button>
        ))}
      </div>

      {result ? (
        <section className="attack__result card" aria-live="polite">
          <h2>{result.description}</h2>
          {result.after.untrusted_text.listing_title ? (
            <blockquote className="attack__quote">
              <span>Seller text (treated as data):</span> “{result.after.untrusted_text.listing_title}”
            </blockquote>
          ) : null}
          {result.before ? (
            <p className="attack__delta">
              Before: {TIER_LABEL[result.before.tier].icon} {result.before.tier} {result.before.score} → After:{" "}
              {TIER_LABEL[result.after.tier].icon} {result.after.tier} {result.after.score}{" "}
              {result.before.tier === result.after.tier && result.before.score === result.after.score ? "· unchanged ✓" : ""}
            </p>
          ) : (
            <p className="attack__delta">
              Verdict: {TIER_LABEL[result.after.tier].icon} {result.after.tier} (score {result.after.score})
            </p>
          )}
          <ul className="card__reasons">
            {result.after.reasons.slice(0, 4).map((r) => (
              <li key={r.code}>{r.text}{r.source ? <span className="card__src"> · {r.source}</span> : null}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="home__foot">
        <button type="button" className="link" onClick={reset}>reset demo</button>
      </footer>
    </main>
  );
}
