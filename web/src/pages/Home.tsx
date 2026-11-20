import { useState, type FormEvent } from "react";
import { Orb } from "../orb/Orb";
import { OrbLabel } from "../orb/OrbLabel";
import { useOrbStore } from "../orb/store";

/**
 * TODO(backend): wire to the API. Send `text` (question or product link),
 * set agentState "scanning" while waiting, then call
 * `useOrbStore.getState().setTier(response.tier)` — tier only from the API.
 */
function onSubmit(text: string): void {
  console.info("[warden] TODO onSubmit", text);
}

export function Home() {
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const agentState = useOrbStore((s) => s.agentState);
  const setAgentState = useOrbStore((s) => s.setAgentState);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = [text.trim(), link.trim()].filter(Boolean).join("\n");
    if (!value) return;
    onSubmit(value);
    setText("");
    setLink("");
  };

  // Tap orb = push-to-talk toggle (voice wiring comes later).
  const toggleTalk = () => setAgentState(agentState === "listening" ? "idle" : "listening");

  const size = typeof window !== "undefined" ? Math.max(280, Math.min(360, window.innerWidth - 48)) : 320;

  return (
    <main className="page home">
      <section className="home__stage">
        <Orb size={size} onToggle={toggleTalk} />
        <OrbLabel />
      </section>

      <form className="home__form" onSubmit={submit}>
        <label className="sr-only" htmlFor="ask">
          Ask Warden
        </label>
        <input
          id="ask"
          type="text"
          placeholder="What do you want to buy?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
        <label className="sr-only" htmlFor="link">
          Paste a link
        </label>
        <input
          id="link"
          type="url"
          inputMode="url"
          placeholder="Paste a link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          autoComplete="off"
        />
        <button type="submit">Check</button>
      </form>

      <footer className="home__foot">
        <a href="#/orb-lab">orb-lab</a>
      </footer>
    </main>
  );
}
