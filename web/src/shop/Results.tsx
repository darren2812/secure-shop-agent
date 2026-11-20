import { useState } from "react";
import type { Result } from "../api";
import { TIER_LABEL } from "../orb/colors";

const RANK = { trusted: 0, caution: 1, blocked: 2 } as const;

function TierChip({ tier }: { tier: Result["tier"] }) {
  return (
    <span className={`tier-chip tier-chip--${tier} tier-chip--sm`}>
      <span className="tier-chip__icon" aria-hidden="true">{TIER_LABEL[tier].icon}</span>{TIER_LABEL[tier].text}
    </span>
  );
}

function Price({ value, className }: { value: number; className: string }) {
  return <span className={className}><small>$</small>{value.toFixed(0)}</span>;
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
);

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
          <Price className="row__price" value={r.price} />
          <TierChip tier={r.tier} />
        </span>
        <span className="row__chev"><Chevron /></span>
      </button>
      {open ? (
        <div id={id} className="row__body">
          <p className="row__meta">{r.store.domain} · score {r.score}</p>
          <Reasons r={r} />
          {r.tier !== "blocked" ? (
            <button type="button" className="btn btn--oscuro card__buy" onClick={() => onBuy(r)}>
              Buy · ${r.price.toFixed(0)}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function Results({ results, onBuy }: { results: Result[]; onBuy: (r: Result) => void }) {
  const [showOthers, setShowOthers] = useState(false);
  const sorted = [...results].sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.score - a.score || a.price - b.price);
  const best = sorted.find((r) => r.tier === "trusted") ?? null;
  const others = sorted.filter((r) => r !== best);
  const blocked = sorted.filter((r) => r.tier === "blocked");
  const avoided = blocked.reduce((s, r) => s + r.price, 0);
  // With no safe pick, never hide the options: the person has to see the warnings.
  const open = showOthers || !best;

  return (
    <section className="results" aria-label="Results">
      {best ? (
        <article className="best oscuro grano" aria-labelledby="best-title">
          <p className="best__eyebrow etiqueta" id="best-title">Best pick · safest store</p>
          <div className="best__top">
            <div>
              <h2 className="best__store">{best.store.name}</h2>
              <p className="best__domain">{best.store.domain} · score {best.score}</p>
            </div>
            <Price className="best__price" value={best.price} />
          </div>
          <div className="best__chips"><TierChip tier={best.tier} /></div>
          <p className="best__reason">{topReason(best)}</p>
          <button type="button" className="btn btn--marca best__buy" onClick={() => onBuy(best)}
            aria-label={`Buy from ${best.store.name} for $${best.price.toFixed(0)}`}>
            Buy · ${best.price.toFixed(0)}
          </button>
        </article>
      ) : (
        <p className="results__none">No safe store found for this item. Look at the warnings below before buying.</p>
      )}

      {avoided > 0 ? (
        <p className="results__avoided">You avoided <strong>${avoided.toFixed(0)}</strong> at {blocked.length === 1 ? "a risky store" : `${blocked.length} risky stores`}.</p>
      ) : null}

      {others.length ? (
        <div>
          {best ? (
            <button type="button" className="results__more" aria-expanded={open} aria-controls="other-options"
              onClick={() => setShowOthers((v) => !v)}>
              <span style={{ flex: 1 }}>{open ? "Hide other options" : `See ${others.length} other option${others.length === 1 ? "" : "s"}`}</span>
              <span className="row__chev" style={open ? { transform: "rotate(180deg)" } : undefined}><Chevron /></span>
            </button>
          ) : null}
          {open ? (
            <ul className="rows" id="other-options">
              {others.map((r) => <Row key={r.listing_id} r={r} onBuy={onBuy} />)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
