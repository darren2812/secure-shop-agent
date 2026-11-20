import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AuditPanel } from "../shop/AuditPanel";

interface DataFlow { service: string; purpose: string; data_sent: string[] | string; data_not_sent: string[] | string }
interface Control { name: string; how: string }
interface Trust { data_flows: DataFlow[]; controls: Control[]; identity?: { verified: boolean } }

// Shown when GET /api/trust is unavailable. Mirrors what the backend enforces.
const FALLBACK: Trust = {
  data_flows: [
    { service: "Claude", purpose: "Explains results in plain language",
      data_sent: ["product query", "store signals", "seller text marked as untrusted"],
      data_not_sent: ["your identity", "card", "spending limits"] },
    { service: "OpenAI GPT-Live", purpose: "Voice conversation",
      data_sent: ["your spoken request", "the spoken summary"],
      data_not_sent: ["identity", "card", "the power to buy"] },
    { service: "Persona", purpose: "Verifies your identity once at signup",
      data_sent: ["ID + selfie (sent directly to Persona)"],
      data_not_sent: ["shopping history", "card"] },
    { service: "SingleStore", purpose: "Store risk signals and hash-chained receipts",
      data_sent: ["store signals", "decisions", "receipt hashes"],
      data_not_sent: ["ID documents", "selfie", "card number"] },
    { service: "Firedrill", purpose: "Attack testing of the agent",
      data_sent: ["synthetic attack prompts"],
      data_not_sent: ["any real user data"] },
  ],
  controls: [
    { name: "Code decides, AI explains", how: "Trust tier and purchase rules are computed in code; the model only words the result." },
    { name: "Seller text is untrusted data", how: "Listing text is spotlighted and can never become an instruction." },
    { name: "Voice can't buy", how: "Purchases need a tap on a named confirm dialog." },
    { name: "Identity verified once", how: "Persona checks you at signup; no ID data leaves Persona." },
    { name: "Single-use purchase decisions", how: "Each approval works once, for one listing and amount." },
    { name: "Hash-chained receipts", how: "Every step is chained; any edit breaks the trail on Verify." },
    { name: "Voice endpoint protected", how: "Short-lived session tokens; API keys stay on the server." },
    { name: "TLS in transit", how: "All traffic is encrypted when deployed." },
  ],
};

const list = (v: string[] | string) => (Array.isArray(v) ? v.join(", ") : v);

type Tab = "receipt" | "data" | "protections";
const TABS: { id: Tab; label: string }[] = [
  { id: "receipt", label: "Receipt" },
  { id: "data", label: "Your data" },
  { id: "protections", label: "Protections" },
];

export function TrustPanel({ requestId }: { requestId: string | null }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("receipt");
  const [trust, setTrust] = useState<Trust | null>(null);
  const [live, setLive] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || trust) return;
    fetch("/api/trust")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Trust) => {
        if (!Array.isArray(d.data_flows) || !Array.isArray(d.controls)) throw new Error("shape");
        setTrust(d);
        setLive(true);
      })
      .catch(() => setTrust(FALLBACK));
  }, [open, trust]);

  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLElement>("[role=tab][aria-selected=true]")?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      opener.current?.focus();
    };
  }, [open]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key !== "Tab" || !sheet.current) return;
    const f = sheet.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])");
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  const onTabKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.id);
    sheet.current?.querySelector<HTMLElement>(`#trust-tab-${next.id}`)?.focus();
  };

  const data = trust ?? FALLBACK;

  return (
    <>
      <button ref={opener} type="button" className="trust-fab" aria-label="Security & receipts"
        aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="trust-backdrop" onClick={() => setOpen(false)}>
          <div ref={sheet} className="trust" role="dialog" aria-modal="true" aria-labelledby="trust-title"
            onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
            <div className="trust__grab" aria-hidden="true" />
            <header className="trust__head">
              <h2 id="trust-title">Security &amp; receipts</h2>
              <button type="button" className="trust__close" aria-label="Close" onClick={() => setOpen(false)}>✕</button>
            </header>

            <div className="trust__tabs" role="tablist" aria-label="Security sections">
              {TABS.map((t, i) => (
                <button key={t.id} id={`trust-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id}
                  aria-controls={`trust-pane-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)} onKeyDown={(e) => onTabKey(e, i)}>
                  {t.label}
                </button>
              ))}
            </div>

            <div className="trust__body" id={`trust-pane-${tab}`} role="tabpanel" aria-labelledby={`trust-tab-${tab}`}>
              {tab === "receipt" ? (
                requestId ? (
                  <>
                    <p className="trust__intro">Every step of this request is logged and hash-chained. Tap Verify to recompute the chain.</p>
                    <AuditPanel requestId={requestId} />
                  </>
                ) : (
                  <p className="trust__empty">No request yet. Ask Warden about a product and its receipt will appear here.</p>
                )
              ) : null}

              {tab === "data" ? (
                <>
                  <p className="trust__intro">
                    Who sees what. {data.identity ? (data.identity.verified ? "Your identity is verified." : "Your identity is not verified yet.") : null}
                    {trust && !live ? <span className="trust__note"> (Offline summary)</span> : null}
                  </p>
                  <ul className="flows">
                    {data.data_flows.map((f) => (
                      <li key={f.service} className="flow">
                        <p className="flow__title"><strong>{f.service}</strong> · {f.purpose}</p>
                        <p className="flow__line"><span className="flow__gets">Gets</span> {list(f.data_sent)}</p>
                        <p className="flow__line"><span className="flow__never">Never gets</span> {list(f.data_not_sent)}</p>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}

              {tab === "protections" ? (
                <ul className="controls">
                  {data.controls.map((c) => (
                    <li key={c.name} className="control">
                      <span className="control__check" aria-hidden="true">✓</span>
                      <span><strong>{c.name}</strong><span className="control__how">{c.how}</span></span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
