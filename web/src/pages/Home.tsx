import { useState, type FormEvent } from "react";
import { api, type Result, type TurnResponse } from "../api";
import { Orb } from "../orb/Orb";
import { OrbLabel } from "../orb/OrbLabel";
import { useOrbStore } from "../orb/store";
import { AuditPanel } from "../shop/AuditPanel";
import { BuyDialog } from "../shop/BuyDialog";
import { Results } from "../shop/Results";
import { useVoice } from "../voice/useVoice";

export function Home() {
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [turn, setTurn] = useState<TurnResponse | null>(null);
  const [buying, setBuying] = useState<Result | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [error, setError] = useState("");
  const agentState = useOrbStore((s) => s.agentState);
  const { setAgentState, setTier, setLabel } = useOrbStore.getState();

  /** Text, pasted link or (later) voice transcript. The tier comes only from the API response. */
  const ask = async (value: string): Promise<string> => {
    setError("");
    setShowAudit(false);
    setTier(null);
    setAgentState("scanning");
    setLabel("Scanning stores…");
    try {
      const r = await api.turn(value);
      setTurn(r);
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
    const value = link.trim() || text.trim();
    if (!value) return;
    void ask(value).catch(() => undefined);
    setText("");
    setLink("");
  };

  const closeBuy = (order?: unknown) => {
    setBuying(null);
    if (turn) setTier(turn.tier); // back to the scan verdict after the verify step
    if (order) setShowAudit(true);
  };

  const reset = async () => {
    await api.reset();
    setTurn(null);
    setShowAudit(false);
    setTier(null);
    setLabel("");
    setAgentState("idle");
  };

  // Tap orb = start / stop voice (GPT-Live, falls back to browser speech).
  const toggleTalk = () => (voice.mode === "off" || voice.mode === "error" ? void voice.start() : voice.stop());
  const size = typeof window !== "undefined" ? Math.max(280, Math.min(360, window.innerWidth - 48)) : 320;

  return (
    <main className="page home">
      <section className="home__stage">
        <Orb size={size} onToggle={toggleTalk} />
        <OrbLabel />
      </section>

      <form className="home__form" onSubmit={submit}>
        <label className="sr-only" htmlFor="ask">Ask Warden</label>
        <input id="ask" type="text" placeholder="What do you want to buy?" value={text}
          onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <label className="sr-only" htmlFor="link">Paste a link</label>
        <input id="link" type="url" inputMode="url" placeholder="Paste a link" value={link}
          onChange={(e) => setLink(e.target.value)} autoComplete="off" />
        <button type="submit" disabled={agentState === "scanning"}>Check</button>
      </form>

      {error || voice.error ? <p className="home__err" role="alert">{error || voice.error}</p> : null}

      {turn ? (
        <>
          <Results results={turn.results} onBuy={setBuying} />
          <button type="button" className="link home__receipt" onClick={() => setShowAudit((v) => !v)}>
            {showAudit ? "Hide receipt" : "View receipt"}
          </button>
          {showAudit ? <AuditPanel requestId={turn.request_id} /> : null}
        </>
      ) : null}

      {buying && turn ? <BuyDialog result={buying} requestId={turn.request_id} onClose={closeBuy} /> : null}

      <footer className="home__foot">
        <a href="#/attack">attack</a> · <a href="#/orb-lab">orb-lab</a> · <button type="button" className="link" onClick={reset}>reset demo</button>
      </footer>
    </main>
  );
}
