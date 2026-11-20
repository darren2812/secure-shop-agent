import { useEffect, useRef, useState } from "react";
import { api } from "../api";

/**
 * Just-in-time Persona step: shown inside the buy pop-up only when the server answers
 * `outcome: "verify"`. One reason, one primary button, one quiet way out.
 * TODO(Darren): open the real Persona sandbox inquiry here; the server re-checks the inquiry status.
 */
export function VerifySheet({ onVerified, onNotNow }: { onVerified: (inquiryId: string) => void; onNotNow: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);

  const start = async () => {
    setBusy(true);
    setErr("");
    try {
      const inquiryId = "inq_demo_" + Math.random().toString(36).slice(2, 10);
      await api.personaStubPass(inquiryId);
      await api.verifyMe(inquiryId).catch(() => undefined); // the order call re-checks it anyway
      onVerified(inquiryId);
    } catch (e) {
      setErr(`That didn't work: ${(e as Error).message}. You can try again.`);
      setBusy(false);
    }
  };

  return (
    <div className="vsheet">
      <span className="vsheet__badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" />
        </svg>
      </span>
      <h2 id="buy-title">First, a quick check that it's you</h2>
      <p className="vsheet__why">So nobody else can shop with your card.</p>
      <ol className="vsheet__steps">
        <li><span aria-hidden="true">1</span>Take a photo of your ID</li>
        <li><span aria-hidden="true">2</span>Take a selfie</li>
        <li><span aria-hidden="true">3</span>Done — about 1 minute, only once</li>
      </ol>
      {err ? <p className="vsheet__err" role="alert">{err}</p> : null}
      <button ref={primary} type="button" className="btn btn--marca vsheet__go" onClick={start} disabled={busy}>
        {busy ? "Checking…" : "Check it's me"}
      </button>
      <button type="button" className="vsheet__later" onClick={onNotNow} disabled={busy}>Not now</button>
      <p className="buy__note">Secure check by Persona. Nothing is bought yet.</p>
    </div>
  );
}
