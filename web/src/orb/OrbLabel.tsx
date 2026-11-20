import { STATE_LABEL, TIER_LABEL } from "./colors";
import { useOrbStore } from "./store";

/** Text + icon under the orb; always present so state never relies on color alone. */
export function OrbLabel() {
  const agentState = useOrbStore((s) => s.agentState);
  const tier = useOrbStore((s) => s.tier);
  const label = useOrbStore((s) => s.label);

  const t = tier ? TIER_LABEL[tier] : null;
  return (
    <div className="orb-label" aria-live="polite" aria-atomic="true">
      {t ? (
        <span className={`tier-chip tier-chip--${tier}`}>
          <span className="tier-chip__icon" aria-hidden="true">
            {t.icon}
          </span>
          {t.text}
        </span>
      ) : null}
      <span className="orb-label__text">{label || STATE_LABEL[agentState]}</span>
    </div>
  );
}
