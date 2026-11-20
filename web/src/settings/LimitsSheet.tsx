import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { api, ApiError, type Profile } from "../api";

const MAX_PER = 5000;
const MAX_CAP = 20000;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Money field: big − / + buttons, a slider and a typed number, all bound to the same value. */
function MoneyField({ id, label, hint, value, max, step, onChange }: {
  id: string; label: string; hint: string; value: number; max: number; step: number; onChange: (n: number) => void;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(1, Math.round(n)));
  return (
    <div className="lfield">
      <label htmlFor={id} className="lfield__label">{label}</label>
      <p className="lfield__hint" id={`${id}-hint`}>{hint}</p>
      <div className="lfield__row">
        <button type="button" className="lfield__step" aria-label={`Lower ${label}`} onClick={() => onChange(clamp(value - step))}>−</button>
        <span className="lfield__num">
          <span aria-hidden="true">$</span>
          <input id={id} type="number" inputMode="numeric" min={1} max={max} value={Number.isFinite(value) ? value : ""}
            aria-describedby={`${id}-hint`}
            onChange={(e) => onChange(e.target.value === "" ? NaN : Math.round(Number(e.target.value)))} />
        </span>
        <button type="button" className="lfield__step" aria-label={`Raise ${label}`} onClick={() => onChange(clamp((Number.isFinite(value) ? value : 0) + step))}>+</button>
      </div>
      <input type="range" className="lfield__range" min={1} max={max} step={step} aria-label={`${label} slider`}
        value={Number.isFinite(value) ? Math.min(max, Math.max(1, value)) : 1} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

/**
 * "Your limits": the person sets what Warden may spend. Saved through the server, which re-checks every
 * purchase against these numbers. The AI has no tool for this: only a human tap in this sheet changes them.
 */
export function LimitsSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [per, setPer] = useState(500);
  const [cap, setCap] = useState(2000);
  const [market, setMarket] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const d = ref.current;
    if (d && !d.open) d.showModal();
    d?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    api.me().then((m) => {
      setProfile(m);
      setPer(m.per_purchase_limit);
      setCap(m.monthly_cap);
      setMarket(m.allow_marketplace);
    }).catch(() => setErr("I couldn't load your limits. Check your connection and try again."));
    return () => opener?.focus?.();
  }, []);

  const close = () => {
    ref.current?.close();
    onClose();
  };

  const save = async () => {
    setErr("");
    if (!Number.isFinite(per) || !Number.isFinite(cap)) return setErr("Please enter a number for both limits.");
    if (per < 1 || per > MAX_PER) return setErr(`Per purchase must be between $1 and ${money(MAX_PER)}.`);
    if (cap < 1 || cap > MAX_CAP) return setErr(`Monthly cap must be between $1 and ${money(MAX_CAP)}.`);
    if (cap < per) return setErr("Your monthly cap can't be lower than your per-purchase limit.");
    setBusy(true);
    try {
      await api.setLimits({ per_purchase_limit: per, monthly_cap: cap, allow_marketplace: market });
      close();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "That didn't save. Please try again.");
      setBusy(false);
    }
  };

  const spent = profile?.spent_this_month ?? 0;
  const pct = Math.min(100, cap > 0 && Number.isFinite(cap) ? (spent / cap) * 100 : 0);

  return (
    <dialog ref={ref} className="psheet lsheet" aria-labelledby="lsheet-title" aria-modal="true"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="psheet__grip" aria-hidden="true" />
      <div className="psheet__head">
        <h2 id="lsheet-title" tabIndex={-1}>Your limits</h2>
        <button type="button" className="psheet__x" onClick={close} aria-label="Close limits">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <p className="psheet__sub">You decide how much Warden can spend. The AI can't change these. Only you can.</p>

      <div className="psheet__list lsheet__body">
        <div className="lspent" role="group" aria-label="Spent this month">
          <p className="lspent__line">Spent this month: <strong>{money(spent)}</strong> of <strong>{Number.isFinite(cap) ? money(cap) : "—"}</strong></p>
          <div className="lspent__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
            <motion.span className={`lspent__fill${pct >= 90 ? " lspent__fill--hot" : ""}`}
              initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }} />
          </div>
        </div>

        <MoneyField id="lim-per" label="Per purchase" hint="Warden warns you about anything pricier than this."
          value={per} max={MAX_PER} step={25} onChange={setPer} />
        <MoneyField id="lim-cap" label="Monthly cap" hint="Warden never spends more than this in a month."
          value={cap} max={MAX_CAP} step={100} onChange={setCap} />

        <label className="ltoggle">
          <span className="ltoggle__text">
            <strong>Allow marketplace sellers</strong>
            <span>Third-party sellers on big sites. Off is safer.</span>
          </span>
          <input type="checkbox" role="switch" checked={market} onChange={(e) => setMarket(e.target.checked)} />
          <span className="ltoggle__track" aria-hidden="true"><span className="ltoggle__knob" /></span>
        </label>
      </div>

      <div className="psheet__foot">
        {err ? <p className="vsheet__err lsheet__err" role="alert">{err}</p> : null}
        <button type="button" className="btn btn--marca psheet__go" onClick={save} disabled={busy || !profile}>
          {busy ? "Saving…" : "Save my limits"}
        </button>
        <button type="button" className="link psheet__cancel" onClick={close} disabled={busy}>Cancel</button>
      </div>
    </dialog>
  );
}
