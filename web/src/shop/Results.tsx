import { useState } from "react";
import type { Result } from "../api";
import { TIER_LABEL } from "../orb/colors";

const RANK = { trusted: 0, caution: 1, blocked: 2 } as const;

function TierChip({ tier }: { tier: Result["tier"] }) {
  return (
    <span className={`tier-chip tier-chip--${tier} tier-chip--sm`}>
      <span aria-hidden="true">{TIER_LABEL[tier].icon}</span> {TIER_LABEL[tier].text}
    </span>
  );
}

function topReason(r: Result) {
  return r.reasons[0]?.text ?? "No risk signals found.";
}

function Reasons({ r }: { r: Result }) {
  return r.reasons.length ? (
    <ul className="card__reasons">
      {r.reasons.slice(0, 4).map((x) => (
        <li key={x.code}>
          {x.text}
          {x.source ? <span className="card__src"> · {x.source}</span> : null}
        </li>
      ))}
    </ul>
  ) : (
    <p className="card__ok">No risk signals found.</p>
  );
}

function Row({ r, onBuy }: { r: Result; onBuy: (r: Result) => void }) {
  const [open, setOpen] = useState(false);
  const id = `row-${r.listing_id}`;
  return (
    <li className={`row row--${r.tier}`}>
      <button type="button" className="row__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <span className="row__main">
          <span className="row__store">{r.store.name}</span>
          <span className="row__reason">{topReason(r)}</span>
        </span>
        <span className="row__side">
          <span className="row__price">${r.price.toFixed(0)}</span>
          <TierChip tier={r.tier} />
        </span>
        <span className="row__chev" aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div id={id} className="row__body">
          <p className="row__meta">{r.store.domain} · score {r.score}</p>
          <Reasons r={r} />
          {r.tier !== "blocked" ? (
            <button type="button" className="card__buy" onClick={() => onBuy(r)}>
              Buy from {r.store.name} · ${r.price.toFixed(0)}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function Results({ results, onBuy }: { results: Result[]; onBuy: (r: Result) => void }) {
  const [showBlocked, setShowBlocked] = useState(false);
  const sorted = [...results].sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.score - a.score || a.price - b.price);
  const best = sorted.find((r) => r.tier === "trusted") ?? null;
  const others = sorted.filter((r) => r !== best && r.tier !== "blocked");
  const blocked = sorted.filter((r) => r.tier === "blocked");
  const avoided = blocked.reduce((s, r) => s + r.price, 0);

  return (
    <section className="results" aria-label="Results">
      {best ? (
        <article className="best" aria-labelledby="best-title">
          <p className="best__eyebrow" id="best-title">Best pick · highest trust score</p>
          <div className="best__top">
            <div>
              <h2 className="best__store">{best.store.name}</h2>
              <p className="best__domain">{best.store.domain} · score {best.score}</p>
            </div>
            <span className="best__price">${best.price.toFixed(0)}</span>
          </div>
          <div className="best__chips"><TierChip tier={best.tier} /></div>
          <p className="best__reason">{topReason(best)}</p>
          <button type="button" className="best__buy" onClick={() => onBuy(best)}>
            Buy from {best.store.name} · ${best.price.toFixed(0)}
          </button>
        </article>
      ) : (
        <p className="results__none">No trusted store found for this item. Review the options below carefully.</p>
      )}

      {others.length ? (
        <div>
          <h2 className="results__h">Other options · {others.length}</h2>
          <ul className="rows">
            {others.map((r) => <Row key={r.listing_id} r={r} onBuy={onBuy} />)}
          </ul>
        </div>
      ) : null}

      {blocked.length ? (
        <div>
          <button type="button" className="results__blocked-toggle" aria-expanded={showBlocked}
            onClick={() => setShowBlocked((v) => !v)}>
            <span aria-hidden="true">{TIER_LABEL.blocked.icon}</span> {blocked.length} blocked — {showBlocked ? "hide" : "show why"}
          </button>
          {showBlocked ? (
            <ul className="rows">
              {blocked.map((r) => <Row key={r.listing_id} r={r} onBuy={onBuy} />)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {avoided > 0 ? (
        <p className="results__avoided">You avoided ${avoided.toFixed(0)} at blocked stores.</p>
      ) : null}
    </section>
  );
}
