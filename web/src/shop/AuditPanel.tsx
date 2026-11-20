import { useEffect, useState } from "react";
import { api, type AuditEvent, type VerifyResult } from "../api";

export function AuditPanel({ requestId }: { requestId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [verify, setVerify] = useState<VerifyResult | null>(null);

  const load = () => api.audit(requestId).then((r) => setEvents(r.events));
  useEffect(() => {
    setVerify(null);
    void load();
  }, [requestId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runVerify = async () => {
    await load();
    setVerify(await api.verify(requestId));
  };

  return (
    <section className="audit" aria-label="Audit trail">
      <h2>Receipt · {requestId}</h2>
      <ol className="audit__list">
        {events.map((e) => (
          <li key={e.seq} className={verify && !verify.intact && verify.broken_seq === e.seq ? "audit__broken" : ""}>
            <span className="audit__step">{e.seq}. {e.step}</span>
            <span className="audit__actor">{e.actor}</span>
            <code className="audit__hash" title={e.hash}>{e.hash.slice(0, 10)}…</code>
          </li>
        ))}
      </ol>
      <button type="button" className="audit__verify" onClick={runVerify}>Verify trail</button>
      {verify ? (
        <p className={verify.intact ? "audit__ok" : "audit__bad"} role="status">
          {verify.intact
            ? `✓ Trail intact · ${verify.events} events`
            : `✕ Trail broken at event ${verify.broken_seq}: ${verify.reason}`}
        </p>
      ) : null}
    </section>
  );
}
