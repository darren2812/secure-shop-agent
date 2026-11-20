import { useEffect, useState } from "react";
import { Orb } from "../orb/Orb";
import { OrbLabel } from "../orb/OrbLabel";
import { TIER_LABEL } from "../orb/colors";
import { useOrbStore } from "../orb/store";
import { demoHeaders, type Reason, type ResultTier } from "../api";

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
      const r: AttackResult = await fetch(`/api/attacks/${name}`, { method: "POST", headers: demoHeaders() }).then((x) => x.json());
      setResult(r);
      setTier(r.after.tier);
      setLabel(`${r.after.store.name}: ${r.after.reasons[0]?.text ?? "no risk signals"}`);
    } finally {
      setAgentState("idle");
      setBusy(false);
    }
  };

  const reset = async () => {
    await fetch("/api/reset_demo", { method: "POST", headers: demoHeaders() });
    setResult(null);
    setTier(null);
    setLabel("Demo data reset");
  };

  const size = Math.max(220, Math.min(260, window.innerWidth - 120));
  const chip = (tier: ResultTier, score: number) => (
    <span className={`tier-chip tier-chip--${tier} tier-chip--sm`}>
      <span className="tier-chip__icon" aria-hidden="true">{TIER_LABEL[tier].icon}</span>
      {TIER_LABEL[tier].text} · {score}
    </span>
  );
  return (
    <main className="page attack">
      <section className="stage oscuro grano" aria-labelledby="attack-title">
        <div className="stage__bar">
          <p className="wordmark">Warden</p>
          <nav className="stage__nav" aria-label="Demo"><a href="#/">Home</a></nav>
        </div>
        <div className="stage__inner">
          <h1 id="attack-title" className="titular stage__title">Attack the agent</h1>
          <Orb size={size} />
          <OrbLabel />
        </div>
        <span className="stage__brandbar" aria-hidden="true" />
      </section>

      <div className="attack__body">
        <p className="attack__intro">Each scenario changes the store data the way an attacker would. Same scoring code as the home page.</p>
        <div className="attack__grid">
          {scenarios.map((s, i) => (
            <button key={s.name} type="button" disabled={busy} onClick={() => run(s.name)}>
              <span className="attack__n">{String(i + 1).padStart(2, "0")}</span>
              <span>{s.description}</span>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
            </button>
          ))}
        </div>

        {result ? (
          <section className="attack__result oscuro grano" aria-live="polite">
            <h2>{result.description}</h2>
            {result.after.untrusted_text.listing_title ? (
              <blockquote className="attack__quote">
                <span>Seller text (treated as data)</span> “{result.after.untrusted_text.listing_title}”
              </blockquote>
            ) : null}
            {result.before ? (
              <p className="attack__delta">
                Before {chip(result.before.tier, result.before.score)} <span className="arrow" aria-label="then">→</span> After{" "}
                {chip(result.after.tier, result.after.score)}
                {result.before.tier === result.after.tier && result.before.score === result.after.score ? (
                  <span className="attack__same"><span aria-hidden="true">✓ </span>Verdict unchanged by the attack</span>
                ) : null}
              </p>
            ) : (
              <p className="attack__delta">Verdict {chip(result.after.tier, result.after.score)}</p>
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
      </div>
    </main>
  );
}
