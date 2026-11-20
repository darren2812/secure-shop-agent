import { useEffect, useRef } from "react";
import type { Result } from "../api";
import { Orb } from "../orb/Orb";
import { TIER_LABEL } from "../orb/colors";
import { useOrbStore } from "../orb/store";
import { Results } from "./Results";

/** Up and to the right of the corner orb: where the Best pick card sits. */
const LOOK_AT_OFFER = { x: 0.8, y: -0.6 };

const FACE_LINE = {
  trusted: "Found a store I trust.",
  caution: "Careful with this one.",
  blocked: "I blocked the risky ones.",
  verify: "Quick check before you buy.",
} as const;

/**
 * Results as one native modal dialog (focus trap, Esc, inert page) that fits the viewport — no
 * page scroll; only the body scrolls if it has to. The corner orb takes its color and face from
 * the API tier in the store. PurchaseSheet / BuyDialog open above it in the top layer.
 */
export function ResultsPopup({
  explanation,
  results,
  onBuy,
  onClose,
  onReceipt,
  onNewSearch,
}: {
  explanation?: string;
  results: Result[];
  onBuy: (r: Result) => void;
  onClose: () => void;
  onReceipt: () => void;
  onNewSearch: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const tier = useOrbStore((s) => s.tier);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const d = ref.current;
    if (d && !d.open) d.showModal();
    ref.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    return () => opener?.focus?.();
  }, []);

  const close = () => {
    ref.current?.close();
    onClose();
  };

  return (
    <dialog ref={ref} className="rpop" aria-labelledby="rpop-title" aria-modal="true"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="psheet__grip" aria-hidden="true" />
      <div className="psheet__head rpop__head">
        <h2 id="rpop-title" tabIndex={-1}>Here's what I found</h2>
        <button type="button" className="psheet__x" onClick={close} aria-label="Close results">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <div className="rpop__body">
        {explanation ? <p className="rpop__why">{explanation}</p> : null}
        <Results results={results} onBuy={onBuy} />
      </div>

      <div className="rpop__foot">
        <Orb size={96} decorative lookAt={LOOK_AT_OFFER} />
        <div className="rpop__say">
          {tier ? (
            <span className={`tier-chip tier-chip--${tier} tier-chip--sm`}>
              <span className="tier-chip__icon" aria-hidden="true">{TIER_LABEL[tier].icon}</span>{TIER_LABEL[tier].text}
            </span>
          ) : null}
          {tier ? <p className="rpop__line">{FACE_LINE[tier]}</p> : null}
          <p className="rpop__links">
            <button type="button" className="link" onClick={onReceipt}>Receipt</button>
            <span aria-hidden="true">·</span>
            <button type="button" className="link" onClick={onNewSearch}>New search</button>
          </p>
        </div>
      </div>
    </dialog>
  );
}
