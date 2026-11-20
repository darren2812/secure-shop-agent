import { useEffect, useRef, useState } from "react";
import { api, type Purchase } from "../api";

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

function shortDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const STATUS: Record<string, string> = { placed: "Ordered", delivered: "Delivered" };

/** Past orders. Reporting a store flags it (so Warden blocks it and stores linked to it). All text is rendered as plain text. */
export function PastPurchasesSheet({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState<Purchase[] | null>(null);
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reportErr, setReportErr] = useState("");

  const load = () => {
    setErr("");
    setRows(null);
    api.purchases().then((r) => setRows(r.purchases))
      .catch(() => setErr("I couldn't load your purchases. Check your connection and try again."));
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

  const report = async (p: Purchase) => {
    setBusy(true);
    setReportErr("");
    try {
      await api.report(p.store_id);
      // Every order from that store is now reported, not just the one tapped.
      setRows((cur) => cur && cur.map((x) => (x.store_id === p.store_id ? { ...x, reported: true } : x)));
      setConfirming(null);
    } catch {
      setReportErr("I couldn't send that report. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="psheet ppsheet" aria-labelledby="ppsheet-title" aria-modal="true"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="psheet__grip" aria-hidden="true" />
      <div className="psheet__head">
        <h2 id="ppsheet-title" tabIndex={-1}>Your purchases</h2>
        <button type="button" className="psheet__x" onClick={close} aria-label="Close purchases">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <p className="psheet__sub">Something wrong with an order? Report the store and Warden will block it.</p>

      <div className="psheet__list rfsheet__body" aria-live="polite">
        {err ? (
          <div className="rfsheet__state">
            <p className="vsheet__err" role="alert">{err}</p>
            <button type="button" className="btn btn--marca" onClick={load}>Try again</button>
          </div>
        ) : rows === null ? (
          <p className="rfsheet__state" role="status">Loading your purchases…</p>
        ) : rows.length === 0 ? (
          <p className="rfsheet__state">No purchases yet.</p>
        ) : (
          <ul className="rfsheet__list">
            {rows.map((p) => (
              <li key={p.id} className={`rfcard ppcard ${p.reported ? "rfcard--blocked" : "rfcard--trusted"}`}>
                <div className="rfcard__top">
                  <span className="ppcard__date">{shortDate(p.date)}</span>
                  {p.reported
                    ? <span className="tier-chip tier-chip--sm tier-chip--blocked">Reported</span>
                    : <span className="ppcard__status">{STATUS[p.status] ?? p.status}</span>}
                </div>
                <h3 className="rfcard__name">{p.store_name}</h3>
                {p.domain ? <p className="rfcard__domain">{p.domain}</p> : null}
                <p className="ppcard__item"><span>{p.title}</span><b>{money(p.amount)}</b></p>
                {p.reported ? null : confirming === p.id ? (
                  <div className="ppcard__confirm" role="group" aria-label={`Report ${p.store_name}`}>
                    <p>Report {p.store_name}? Warden will block it and stores linked to it.</p>
                    {reportErr ? <p className="vsheet__err" role="alert">{reportErr}</p> : null}
                    <div className="ppcard__btns">
                      <button type="button" className="btn ppcard__danger" disabled={busy} onClick={() => report(p)}>
                        {busy ? "Reporting…" : "Yes, report"}
                      </button>
                      <button type="button" className="btn" disabled={busy} onClick={() => { setConfirming(null); setReportErr(""); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="btn ppcard__report" onClick={() => { setConfirming(p.id); setReportErr(""); }}>
                    <span aria-hidden="true">🚩 </span>Report a problem
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="psheet__foot">
        <button type="button" className="btn btn--marca psheet__go" onClick={close}>Done</button>
      </div>
    </dialog>
  );
}
