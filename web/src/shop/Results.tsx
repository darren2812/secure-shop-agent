import { useState } from "react";
import type { Result } from "../api";
import { TIER_LABEL } from "../orb/colors";

const ORDER = ["trusted", "caution", "blocked"] as const;
const HEADINGS = { trusted: "Trusted", caution: "Caution", blocked: "Blocked" };

export function Results({ results, onBuy }: { results: Result[]; onBuy: (r: Result) => void }) {
  const [showBlocked, setShowBlocked] = useState(false);
  const avoided = results.filter((r) => r.tier === "blocked").reduce((s, r) => s + r.price, 0);

  return (
    <section className="results" aria-label="Results">
      {ORDER.map((tier) => {
        const rows = results.filter((r) => r.tier === tier);
        if (!rows.length) return null;
        const collapsed = tier === "blocked" && !showBlocked;
        return (
          <div key={tier} className={`results__group results__group--${tier}`}>
            <h2>
              <span aria-hidden="true">{TIER_LABEL[tier].icon}</span> {HEADINGS[tier]} · {rows.length}
              {tier === "blocked" ? (
                <button type="button" className="link" onClick={() => setShowBlocked((v) => !v)}>
                  {collapsed ? "Show why" : "Hide"}
                </button>
              ) : null}
            </h2>
            {collapsed
              ? null
              : rows.map((r) => (
                  <article key={r.listing_id} className={`card card--${r.tier}`}>
                    <header>
                      <strong>{r.store.name}</strong>
                      <span className="card__price">${r.price.toFixed(0)}</span>
                    </header>
                    <div className="card__meta">
                      <span className={`tier-chip tier-chip--${r.tier} tier-chip--sm`}>
                        <span aria-hidden="true">{TIER_LABEL[r.tier].icon}</span> {TIER_LABEL[r.tier].text}
                      </span>
                      <span className="card__score">score {r.score}</span>
                      <span className="card__domain">{r.store.domain}</span>
                    </div>
                    {r.reasons.length ? (
                      <ul className="card__reasons">
                        {r.reasons.slice(0, 3).map((x) => (
                          <li key={x.code}>
                            {x.text}
                            {x.source ? <span className="card__src"> · {x.source}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="card__ok">No risk signals found.</p>
                    )}
                    {r.tier !== "blocked" ? (
                      <button type="button" className="card__buy" onClick={() => onBuy(r)}>
                        Buy · ${r.price.toFixed(0)}
                      </button>
                    ) : null}
                  </article>
                ))}
          </div>
        );
      })}
      {avoided > 0 ? (
        <p className="results__avoided">You avoided ${avoided.toFixed(0)} at blocked stores.</p>
      ) : null}
    </section>
  );
}
