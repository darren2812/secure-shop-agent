import { useEffect, useRef, useState } from "react";
import { api, type RedFlagStore } from "../api";

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

function priceLine(s: RedFlagStore): string | null {
  if (s.price == null) return null;
  if (s.typical_price == null) return money(s.price);
  const below = s.pct_below ? ` (${s.pct_below}% below)` : "";
  return `${money(s.price)} · typical ${money(s.typical_price)}${below}`;
}

const TIER_LABEL: Record<string, string> = { blocked: "Blocked", caution: "Caution", trusted: "Trusted" };
const TIER_ICON: Record<string, string> = { blocked: "✕", caution: "!", trusted: "✓" };

function StoreCard({ s }: { s: RedFlagStore }) {
  const price = priceLine(s);
  return (
    <li className={`rfcard rfcard--${s.tier}`}>
      <div className="rfcard__top">
        <span className={`tier-chip tier-chip--${s.tier}`}>
          <span className="tier-chip__icon" aria-hidden="true">{TIER_ICON[s.tier] ?? "?"}</span>
          {TIER_LABEL[s.tier] ?? s.tier}
        </span>
        <span className="rfcard__score" aria-label={`Score ${s.score} out of 100`}><b>{s.score}</b>/100</span>
      </div>
      <h3 className="rfcard__name">{s.name}</h3>
      <p className="rfcard__domain">{s.domain}</p>
      {price ? <p className="rfcard__price">{price}</p> : null}
      {s.reasons.length ? (
        <ul className="rfcard__reasons">
          {s.reasons.map((r) => <li key={r.code}>{r.text}</li>)}
        </ul>
      ) : null}
    </li>
  );
}

/** Every store with its trust score: red flags (blocked/caution) first, then trusted. Read-only; tiers come from code. */
export function RedFlagsSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [stores, setStores] = useState<RedFlagStore[] | null>(null);
  const [err, setErr] = useState("");

  const load = () => {
    setErr("");
    setStores(null);
    api.redFlags().then((r) => setStores(r.stores))
      .catch(() => setErr("I couldn't load the flagged stores. Check your connection and try again."));
  };

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const d = ref.current;
    if (d && !d.open) d.showModal();
    d?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    load();
    return () => opener?.focus?.();
  }, []);

  const close = () => {
    ref.current?.close();
    onClose();
  };

  return (
    <dialog ref={ref} className="psheet rfsheet" aria-labelledby="rfsheet-title" aria-modal="true"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="psheet__grip" aria-hidden="true" />
      <div className="psheet__head">
        <h2 id="rfsheet-title" tabIndex={-1}>Store trust scores</h2>
        <button type="button" className="psheet__x" onClick={close} aria-label="Close flagged stores">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <p className="psheet__sub">Every store Warden checked, scored 0–100 by code. You can't buy from blocked stores.</p>

      <div className="psheet__list rfsheet__body" aria-live="polite">
        {err ? (
          <div className="rfsheet__state">
            <p className="vsheet__err" role="alert">{err}</p>
            <button type="button" className="btn btn--marca" onClick={load}>Try again</button>
          </div>
        ) : stores === null ? (
          <p className="rfsheet__state" role="status">Checking stores…</p>
        ) : (
          <>
            <h3 className="rfsheet__section">Red flags ({stores.filter((s) => s.tier !== "trusted").length})</h3>
            <ul className="rfsheet__list">
              {stores.filter((s) => s.tier !== "trusted").map((s) => <StoreCard key={s.store_id} s={s} />)}
            </ul>
            <h3 className="rfsheet__section">Trusted ({stores.filter((s) => s.tier === "trusted").length})</h3>
            <ul className="rfsheet__list">
              {stores.filter((s) => s.tier === "trusted").map((s) => <StoreCard key={s.store_id} s={s} />)}
            </ul>
          </>
        )}
      </div>

      <div className="psheet__foot">
        <button type="button" className="btn btn--marca psheet__go" onClick={close}>Got it</button>
      </div>
    </dialog>
  );
}
