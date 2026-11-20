import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Result, type TurnResponse } from "../api";
import { Orb } from "../orb/Orb";
import { OrbLabel } from "../orb/OrbLabel";
import { useOrbStore } from "../orb/store";
import { AuditPanel } from "../shop/AuditPanel";
import { BuyDialog } from "../shop/BuyDialog";
import { PurchaseSheet } from "../shop/PurchaseSheet";
import { ResultsPopup } from "../shop/ResultsPopup";
import { LimitsSheet } from "../settings/LimitsSheet";
import { TrustPanel } from "../trust/TrustPanel";
import { useVoice } from "../voice/useVoice";

export function Home() {
  const [text, setText] = useState("");
  const [turn, setTurn] = useState<TurnResponse | null>(null);
  const [buying, setBuying] = useState<Result | null>(null);
  /** Purchase sheet: null = closed; focus = listing the person or the agent pointed at. */
  const [sheet, setSheet] = useState<{ focus: string | null } | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  /** Results pop-up over the home orb; the "View results" chip reopens it. */
  const [popup, setPopup] = useState(false);
  const [error, setError] = useState("");
  const [limits, setLimits] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);
  useEffect(() => {
    api.me().then((m) => setVerified(m.verified)).catch(() => setVerified(null));
  }, []);

  // Persona is asked just-in-time inside the buy pop-up (server says `outcome: "verify"`), never up front.
  const agentState = useOrbStore((s) => s.agentState);
  const { setAgentState, setTier, setLabel } = useOrbStore.getState();

  /** Text, pasted link or (later) voice transcript. The tier comes only from the API response. */
  // Ref so the voice callback (captured once by useVoice) always sees the latest turn.
  const turnRef = useRef<TurnResponse | null>(null);
  const ask = async (value: string): Promise<string> => {
    setError("");
    setShowAudit(false);
    setTier(null);
    setAgentState("scanning");
    setLabel("Checking stores…");
    try {
      // Follow-ups ("I want to buy", "the Amazon one") stay in the same conversation + receipt.
      const r = await api.turn(value, turnRef.current?.request_id);
      turnRef.current = r;
      setTurn(r);
      // Tool call from the agent: open the purchase sheet, optionally pointing at one listing.
      // The agent never buys — the person still taps Continue and confirms.
      if (r.ui_action?.type === "show_options") setSheet((s) => ({ focus: s?.focus ?? null }));
      else if (r.ui_action?.type === "focus_listing") setSheet({ focus: r.ui_action.listing_id ?? null });
      // Plain answers with stores open the results pop-up; agent tool calls go straight to the sheet.
      else if (r.results.length) setPopup(true);
      setTier(r.tier);
      setLabel(r.say);
      return r.say;
    } catch (e) {
      setError((e as Error).message);
      setLabel("");
      throw e;
    } finally {
      if (useOrbStore.getState().agentState === "scanning") setAgentState(voice.mode === "live" ? "listening" : "idle");
    }
  };
  const voice = useVoice(ask);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    void ask(value).catch(() => undefined);
    setText("");
  };

  const askChip = (value: string) => void ask(value).catch(() => undefined);
  const pasteLink = async () => {
    const input = document.getElementById("ask") as HTMLInputElement | null;
    try {
      const clip = (await navigator.clipboard?.readText())?.trim();
      if (clip) setText(clip);
    } catch {
      /* no clipboard permission: just focus the field */
    }
    input?.focus();
  };

  const closeBuy = (order?: unknown) => {
    setBuying(null);
    if (turn) setTier(turn.tier); // back to the scan verdict after the verify step
    if (order) {
      setPopup(false);
      setShowAudit(true);
      setVerified(true);
    }
  };

  const newSearch = () => {
    turnRef.current = null;
    setTurn(null);
    setSheet(null);
    setPopup(false);
    setShowAudit(false);
    setTier(null);
    setLabel("");
    setTimeout(() => document.getElementById("ask")?.focus(), 0);
  };

  const [resetting, setResetting] = useState(false);
  const reset = async () => {
    if (resetting) return;
    setResetting(true);
    setError("");
    try {
      await api.reset();
    } catch (e) {
      setError(`Reset failed: ${(e as Error).message}`);
      setResetting(false);
      return;
    }
    setResetting(false);
    turnRef.current = null;
    setSheet(null);
    setPopup(false);
    setTurn(null);
    setShowAudit(false);
    setVerified(false);
    setTier(null);
    setLabel("Demo reset. Fresh start.");
    setAgentState("idle");
  };

  // Tap orb = start / stop voice (GPT-Live, falls back to browser speech).
  const toggleTalk = () => (voice.mode === "off" || voice.mode === "error" ? void voice.start() : voice.stop());
  const size = typeof window !== "undefined" ? Math.max(260, Math.min(320, window.innerWidth - 96)) : 320;

  return (
    <main className={`page home${popup ? " home--popup" : ""}`}>
      <section className="home__stage stage oscuro grano" aria-labelledby="home-title">
        <div className="stage__bar">
          <p className="wordmark">Warden</p>
          <button type="button" className="limitsbtn" onClick={() => setLimits(true)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><path d="M4 7.5V17a2 2 0 0 0 2 2h12.5a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 18.5 9H6.5A2.5 2.5 0 0 1 4 7.5Z" /><circle cx="16" cy="13.5" r="1" fill="currentColor" />
            </svg>
            Limits
          </button>
          {verified !== null ? (
            <span className={`idpill ${verified ? "idpill--ok" : ""}`}>
              {verified ? <><span aria-hidden="true">✓ </span>Verified</> : "Not verified yet"}
            </span>
          ) : null}
        </div>
        <div className="stage__inner">
          <h1 id="home-title" className="titular stage__title">Tell me what you want. I'll find a safe store.</h1>
          {/* One WebGL orb at a time: the pop-up's corner orb replaces this one while it is open. */}
          {popup ? <div className="orb-slot" style={{ width: size, height: size }} aria-hidden="true" /> : <Orb size={size} onToggle={toggleTalk} />}
          <OrbLabel />
          {turn?.results.length && !popup ? (
            <button type="button" className="chip viewres" onClick={() => setPopup(true)}>
              View results <span aria-hidden="true">↑</span>
            </button>
          ) : null}
          {voice.mode !== "off" && (voice.youSaid || voice.wardenSays) ? (
            <div className="captions" aria-live="polite">
              {voice.youSaid ? <p className="captions__you"><span>You</span>{voice.youSaid}</p> : null}
              {voice.wardenSays ? <p className="captions__warden"><span>Warden</span>{voice.wardenSays}</p> : null}
            </div>
          ) : null}
        </div>
        <span className="stage__brandbar" aria-hidden="true" />
      </section>

      <div className="home__body">
        <form className="home__form" onSubmit={submit}>
          <label className="home__label" htmlFor="ask">Or type it here</label>
          <div className="home__row">
            <input id="ask" type="text" placeholder="A product, or paste a link" value={text}
              onChange={(e) => setText(e.target.value)} autoComplete="off" enterKeyHint="search" />
            <button type="submit" className="btn btn--marca home__check" disabled={agentState === "scanning" || !text.trim()}>
              {agentState === "scanning" ? "Checking…" : "Check"}
            </button>
          </div>
        </form>

        {!turn && agentState !== "scanning" ? (
          <div className="chips" role="group" aria-label="Try one">
            <button type="button" className="chip" onClick={() => askChip("AirPods Pro")}>AirPods Pro</button>
            <button type="button" className="chip" onClick={() => askChip("Nintendo Switch 2")}>Nintendo Switch 2</button>
            <button type="button" className="chip" onClick={pasteLink}>Paste a link</button>
          </div>
        ) : null}

        {error || voice.error ? <p className="home__err" role="alert">{error || voice.error}</p> : null}

        {turn ? (
          <>
            <button type="button" className="link home__receipt" onClick={() => setShowAudit((v) => !v)}>
              {showAudit ? "Hide receipt" : "View receipt"}
            </button>
            <button type="button" className="link home__new" onClick={newSearch}>New search</button>
            {showAudit ? <AuditPanel requestId={turn.request_id} /> : null}
          </>
        ) : null}

        <footer className="home__foot">
          <a href="#/attack">attack demo</a> · <a href="#/orb-lab">orb-lab</a> · <button type="button" className="link" onClick={reset} disabled={resetting}>{resetting ? "resetting…" : "reset demo"}</button>
        </footer>
      </div>

      {popup && turn ? (
        <ResultsPopup explanation={turn.explanation} results={turn.results}
          onBuy={(r) => setSheet({ focus: r.listing_id })}
          onClose={() => setPopup(false)}
          onReceipt={() => { setPopup(false); setShowAudit(true); }}
          onNewSearch={newSearch} />
      ) : null}

      {sheet && turn && !buying ? (
        <PurchaseSheet results={turn.results} focusedId={sheet.focus}
          onClose={() => setSheet(null)}
          onContinue={(r) => { setSheet(null); setBuying(r); }} />
      ) : null}

      {buying && turn ? <BuyDialog result={buying} requestId={turn.request_id} onClose={closeBuy} /> : null}

      {limits ? <LimitsSheet onClose={() => setLimits(false)} /> : null}

      <TrustPanel requestId={turn?.request_id ?? null} />
    </main>
  );
}
