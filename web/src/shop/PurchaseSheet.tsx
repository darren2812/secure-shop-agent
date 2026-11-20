import { useEffect, useRef, useState } from "react";
import type { Result } from "../api";
import { TIER_LABEL } from "../orb/colors";

const RANK = { trusted: 0, caution: 1, blocked: 2 } as const;

const reasonOf = (r: Result) => r.reasons[0]?.text ?? "No risk signals found.";

/**
 * "Choose where to buy": every store the scan found, buyable first (Trusted, then Caution), blocked
 * last and not selectable. One primary action hands the chosen listing to the existing BuyDialog,
 * which re-checks policy server-side. The agent can open this (`show_options`) or point at one
 * listing (`focus_listing`), but only the person taps Continue.
 */
export function PurchaseSheet({
  results,
  focusedId,
  onContinue,
  onClose,
}: {
  results: Result[];
  focusedId?: string | null;
  onContinue: (r: Result) => void;
  onClose: () => void;
}) {
  const sorted = [...results].sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.score - a.score || a.price - b.price);
  const buyable = sorted.filter((r) => r.tier !== "blocked");
  const blocked = sorted.filter((r) => r.tier === "blocked");
  const focused = focusedId ? sorted.find((r) => r.listing_id === focusedId) ?? null : null;
  const focusedBlocked = focused?.tier === "blocked";
  const initial = focused && !focusedBlocked ? focused.listing_id : buyable[0]?.listing_id ?? null;

  const [selected, setSelected] = useState<string | null>(initial);
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => (opener.current as HTMLElement | null)?.focus?.();
  }, []);

  // When the agent points at a different listing (voice/text follow-up), follow it.
  useEffect(() => {
    setSelected(initial);
    const target = focused?.listing_id ?? initial;
    const el = target ? ref.current?.querySelector<HTMLElement>(`[data-listing="${CSS.escape(target)}"]`) : null;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" });
    // Focus the selected (radio) row so arrow keys work; otherwise the heading.
    const radio = initial ? ref.current?.querySelector<HTMLElement>(`input[value="${CSS.escape(initial)}"]`) : null;
    (radio ?? ref.current?.querySelector<HTMLElement>("h2"))?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId]);

  const choice = buyable.find((r) => r.listing_id === selected) ?? null;

  const close = () => {
    ref.current?.close();
    onClose();
  };

  return (
    <dialog ref={ref} className="psheet" aria-labelledby="psheet-title" aria-describedby="psheet-sub"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="psheet__grip" aria-hidden="true" />
      <div className="psheet__head">
        <h2 id="psheet-title" tabIndex={-1}>Choose where to buy</h2>
        <button type="button" className="psheet__x" onClick={close} aria-label="Close">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <p id="psheet-sub" className="psheet__sub">
        {sorted.length} store{sorted.length === 1 ? "" : "s"} found. Pick one — nothing is bought until you confirm.
      </p>

      {focusedBlocked && focused ? (
        <p className="psheet__alert" role="alert">
          <strong>{focused.store.name} is blocked.</strong> {reasonOf(focused)}
          {buyable[0] ? ` I picked ${buyable[0].store.name} instead.` : ""}
        </p>
      ) : null}

      <div className="psheet__list">
        {buyable.length ? (
          <fieldset className="psheet__group">
            <legend className="etiqueta">You can buy here</legend>
            {buyable.map((r) => {
              const isFocus = r.listing_id === focusedId;
              const on = r.listing_id === selected;
              return (
                <label key={r.listing_id} data-listing={r.listing_id}
                  className={`popt popt--${r.tier}${on ? " popt--on" : ""}${isFocus ? " popt--focus" : ""}`}>
                  <input type="radio" name="psheet-choice" value={r.listing_id} checked={on}
                    onChange={() => setSelected(r.listing_id)} />
                  <span className="popt__dot" aria-hidden="true" />
                  <span className="popt__main">
                    {isFocus ? <span className="popt__asked">You asked for this one</span> : null}
                    <span className="popt__store">{r.store.name}</span>
                    <span className="popt__reason">{reasonOf(r)}</span>
                  </span>
                  <span className="popt__side">
                    <span className="popt__price"><small>$</small>{r.price.toFixed(0)}</span>
                    <span className={`tier-chip tier-chip--${r.tier} tier-chip--sm`}>
                      <span className="tier-chip__icon" aria-hidden="true">{TIER_LABEL[r.tier].icon}</span>{TIER_LABEL[r.tier].text}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : (
          <p className="psheet__none">No store here is safe to buy from.</p>
        )}

        {blocked.length ? (
          <div className="psheet__group" role="group" aria-labelledby="psheet-blocked">
            <p id="psheet-blocked" className="etiqueta psheet__legend">Blocked by Warden</p>
            <ul className="psheet__blocked">
              {blocked.map((r) => (
                <li key={r.listing_id} data-listing={r.listing_id}
                  className={`popt popt--blocked popt--off${r.listing_id === focusedId ? " popt--focus" : ""}`}>
                  <span className="popt__main">
                    {r.listing_id === focusedId ? <span className="popt__asked">You asked for this one</span> : null}
                    <span className="popt__store">{r.store.name}</span>
                    <span className="popt__reason">{reasonOf(r)}</span>
                    <span className="popt__no">Can't buy here — blocked</span>
                  </span>
                  <span className="popt__side">
                    <span className="popt__price"><small>$</small>{r.price.toFixed(0)}</span>
                    <span className="tier-chip tier-chip--blocked tier-chip--sm">
                      <span className="tier-chip__icon" aria-hidden="true">{TIER_LABEL.blocked.icon}</span>{TIER_LABEL.blocked.text}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="psheet__foot">
        <button type="button" className="btn btn--marca psheet__go" disabled={!choice} onClick={() => choice && onContinue(choice)}>
          {choice ? `Continue with ${choice.store.name} · $${choice.price.toFixed(0)}` : "Pick a store"}
        </button>
        <button type="button" className="link psheet__cancel" onClick={close}>Cancel</button>
      </div>
    </dialog>
  );
}
