import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Decision, type Order, type Result } from "../api";
import { useOrbStore } from "../orb/store";

type Step = "checking" | "confirm" | "verify" | "placing" | "done" | "denied" | "error";

/**
 * Named confirm dialog. The only path to a purchase: tap Buy → server re-checks policy →
 * user confirms with name + price visible → Persona step-up if required → order.
 */
export function BuyDialog({ result, requestId, onClose }: { result: Result; requestId: string; onClose: (o?: Order) => void }) {
  const [step, setStep] = useState<Step>("checking");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<{ message: string; charged: boolean } | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const setTier = useOrbStore((s) => s.setTier);

  useEffect(() => {
    ref.current?.showModal();
    api
      .checkPolicy(result.listing_id, requestId)
      .then((d) => {
        setDecision(d);
        setStep(d.outcome === "deny" ? "denied" : "confirm");
      })
      .catch((e: ApiError) => {
        setError({ message: e.message, charged: false });
        setStep("error");
      });
  }, [result.listing_id, requestId]);

  const place = async (verificationId?: string) => {
    if (!decision) return;
    setStep("placing");
    try {
      const o = await api.order(decision.decision_id, verificationId);
      setOrder(o);
      setStep("done");
    } catch (e) {
      const err = e as ApiError;
      setError({ message: err.message, charged: err.charged });
      setStep("error");
    }
  };

  const confirm = () => {
    if (decision?.outcome === "verify") {
      setTier("verify"); // server said verification is required
      setStep("verify");
    } else {
      void place();
    }
  };

  // TODO(Darren): replace with the real Persona sandbox inquiry flow; the server re-checks the inquiry status.
  const verifyWithPersona = async () => {
    const inquiryId = "inq_demo_" + Math.random().toString(36).slice(2, 10);
    await api.personaStubPass(inquiryId);
    await place(inquiryId);
  };

  const close = () => {
    ref.current?.close();
    onClose(order ?? undefined);
  };

  return (
    <dialog ref={ref} className="buy" onCancel={close} aria-labelledby="buy-title">
      {step === "checking" ? <p>Checking your rules…</p> : null}

      {decision && (step === "confirm" || step === "verify" || step === "placing") ? (
        <>
          <h2 id="buy-title">
            Buy {result.title.length > 40 ? "this item" : result.title} from {decision.store.name} — ${decision.amount.toFixed(0)}?
          </h2>
          <ul className="buy__reasons">
            {decision.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
            {decision.score_reasons.map((r) => (
              <li key={r} className="buy__muted">{r}</li>
            ))}
          </ul>
          {step === "verify" ? (
            <div className="buy__verify">
              <p>🔒 Over your limit — verify it's you with Persona (ID + selfie).</p>
              <div className="buy__actions">
                <button type="button" onClick={close}>Cancel</button>
                <button type="button" onClick={verifyWithPersona}>Verify with Persona</button>
              </div>
            </div>
          ) : (
            <div className="buy__actions">
              <button type="button" onClick={close} disabled={step === "placing"}>Cancel</button>
              <button type="button" onClick={confirm} disabled={step === "placing"}>
                {step === "placing" ? "Placing…" : "Confirm"}
              </button>
            </div>
          )}
          <p className="buy__note">Simulated checkout — no money moves.</p>
        </>
      ) : null}

      {step === "denied" && decision ? (
        <>
          <h2 id="buy-title">Not allowed</h2>
          <p>{decision.reasons[0]}</p>
          <p className="buy__note">Not charged.</p>
          <div className="buy__actions"><button type="button" onClick={close}>Close</button></div>
        </>
      ) : null}

      {step === "done" && order ? (
        <>
          <h2 id="buy-title">Order placed</h2>
          <p>${order.amount.toFixed(0)} · {decision?.store.name} · receipt saved to your audit trail.</p>
          <div className="buy__actions"><button type="button" onClick={close}>See receipt</button></div>
        </>
      ) : null}

      {step === "error" && error ? (
        <>
          <h2 id="buy-title">{error.charged ? "Charged, but something failed" : "Not charged"}</h2>
          <p>{error.message}</p>
          <div className="buy__actions"><button type="button" onClick={close}>Close</button></div>
        </>
      ) : null}
    </dialog>
  );
}
