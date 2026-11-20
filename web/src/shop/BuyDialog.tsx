import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Decision, type Order, type Result } from "../api";
import { VerifySheet } from "../onboarding/VerifySheet";
import { useOrbStore } from "../orb/store";

type Step = "checking" | "verify" | "confirm" | "placing" | "done" | "denied" | "error";

/**
 * Buy pop-up, one decision per screen. The only path to a purchase: tap Buy → server re-checks
 * policy → (first time only) Persona check → user confirms with name + price visible → order.
 */
export function BuyDialog({ result, requestId, onClose }: { result: Result; requestId: string; onClose: (o?: Order) => void }) {
  const [step, setStep] = useState<Step>("checking");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [verificationId, setVerificationId] = useState<string | undefined>();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<{ message: string; charged: boolean } | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const setTier = useOrbStore((s) => s.setTier);

  useEffect(() => {
    opener.current = document.activeElement;
    ref.current?.showModal();
    api
      .checkPolicy(result.listing_id, requestId)
      .then((d) => {
        setDecision(d);
        if (d.outcome === "deny") setStep("denied");
        else if (d.outcome === "verify") {
          setTier("verify"); // server said verification is required
          setStep("verify");
        } else setStep("confirm");
      })
      .catch((e: ApiError) => {
        setError({ message: e.message, charged: false });
        setStep("error");
      });
  }, [result.listing_id, requestId, setTier]);

  // Each screen puts focus on its heading so screen readers announce the new step.
  useEffect(() => {
    if (step !== "verify") ref.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [step]);

  const place = async () => {
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

  const close = () => {
    ref.current?.close();
    (opener.current as HTMLElement | null)?.focus?.();
    onClose(order ?? undefined);
  };

  const name = result.title.length > 40 ? "this item" : result.title;

  return (
    <dialog ref={ref} className={`buy buy--${step}`} onCancel={close} aria-labelledby="buy-title">
      {step === "checking" ? <h2 id="buy-title" tabIndex={-1}>Checking it's safe…</h2> : null}

      {step === "verify" ? (
        <VerifySheet
          onVerified={(id) => {
            setVerificationId(id);
            setTier(result.tier);
            setStep("confirm");
          }}
          onNotNow={close}
        />
      ) : null}

      {decision && (step === "confirm" || step === "placing") ? (
        <>
          {verificationId ? <p className="buy__ok">✓ It's you. Thanks — you won't be asked again.</p> : null}
          <h2 id="buy-title" tabIndex={-1}>
            Buy {name} from {decision.store.name} for ${decision.amount.toFixed(0)}?
          </h2>
          <ul className="buy__reasons">
            {decision.reasons
              .filter((r) => !(verificationId && /identity/i.test(r))) // just done above; don't ask twice
              .map((r) => <li key={r}>{r}</li>)}
            {decision.warnings.map((w) => <li key={w} className="buy__warn">! {w}</li>)}
          </ul>
          <div className="buy__actions">
            <button type="button" onClick={close} disabled={step === "placing"}>Cancel</button>
            <button type="button" className="buy__primary" onClick={place} disabled={step === "placing"}>
              {step === "placing" ? "Buying…" : "Yes, buy it"}
            </button>
          </div>
          <p className="buy__note">Demo checkout — no real money moves.</p>
        </>
      ) : null}

      {step === "denied" && decision ? (
        <>
          <h2 id="buy-title" tabIndex={-1}>Warden stopped this one</h2>
          <p>{decision.reasons[0]}</p>
          <p className="buy__note">You were not charged.</p>
          <div className="buy__actions"><button type="button" onClick={close}>OK</button></div>
        </>
      ) : null}

      {step === "done" && order ? (
        <>
          <span className="buy__done" aria-hidden="true">✓</span>
          <h2 id="buy-title" tabIndex={-1}>Done — order placed</h2>
          <p className="buy__sum">${order.amount.toFixed(0)} at {decision?.store.name}. Your receipt is saved.</p>
          <p className="buy__note">Not charged real money: this is a demo.</p>
          <div className="buy__actions"><button type="button" className="buy__primary" onClick={close}>Close</button></div>
        </>
      ) : null}

      {step === "error" && error ? (
        <>
          <h2 id="buy-title" tabIndex={-1}>{error.charged ? "Charged, but something went wrong" : "Something went wrong — not charged"}</h2>
          <p>{error.message}</p>
          <div className="buy__actions"><button type="button" onClick={close}>Close</button></div>
        </>
      ) : null}
    </dialog>
  );
}
