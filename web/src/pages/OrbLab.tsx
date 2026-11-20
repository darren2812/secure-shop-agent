import { useEffect, useRef, useState } from "react";
import { Orb } from "../orb/Orb";
import { OrbLabel } from "../orb/OrbLabel";
import { AGENT_STATES, TIERS, useOrbStore } from "../orb/store";
import { attachLevelMeter } from "../audio/level";

/** Design / video / screenshot bench. Forces state × tier directly (lab only). */
export function OrbLab() {
  const s = useOrbStore();
  const [mic, setMic] = useState<"off" | "on" | "error">("off");
  const micRef = useRef<{ stream: MediaStream; detach: () => void } | null>(null);

  const stopMic = () => {
    micRef.current?.detach();
    micRef.current?.stream.getTracks().forEach((t) => t.stop());
    micRef.current = null;
    setMic("off");
  };

  const toggleMic = async () => {
    if (micRef.current) return stopMic();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = { stream, detach: attachLevelMeter(stream) };
      setMic("on");
      if (s.agentState === "idle") s.setAgentState("listening");
    } catch (e) {
      console.error(e);
      setMic("error");
    }
  };

  useEffect(() => stopMic, []);

  return (
    <main className="page lab">
      <header className="lab__head">
        <h1>Warden · orb-lab</h1>
        <a href="#/">← home</a>
      </header>

      <section className="lab__stage">
        <Orb size={320} />
        <OrbLabel />
      </section>

      <section className="lab__controls">
        <fieldset>
          <legend>Agent state</legend>
          {AGENT_STATES.map((a) => (
            <button key={a} aria-pressed={s.agentState === a} onClick={() => s.setAgentState(a)}>
              {a}
            </button>
          ))}
        </fieldset>

        <fieldset>
          <legend>Tier (normally only from API)</legend>
          {TIERS.map((t) => (
            <button key={t ?? "none"} aria-pressed={s.tier === t} onClick={() => s.setTier(t)}>
              {t ?? "none"}
            </button>
          ))}
        </fieldset>

        <fieldset>
          <legend>All combos</legend>
          <div className="lab__grid">
            {AGENT_STATES.flatMap((a) =>
              TIERS.map((t) => (
                <button
                  key={`${a}-${t}`}
                  aria-pressed={s.agentState === a && s.tier === t}
                  onClick={() => {
                    s.setAgentState(a);
                    s.setTier(t);
                  }}
                >
                  {a} · {t ?? "—"}
                </button>
              )),
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend>Level (u_level) {s.level.toFixed(2)}</legend>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={s.level}
            disabled={mic === "on"}
            onChange={(e) => s.setLevel(Number(e.target.value))}
            aria-label="Audio level"
          />
        </fieldset>

        <fieldset>
          <legend>Options</legend>
          <label className="lab__check">
            <input
              type="checkbox"
              checked={s.forceReducedMotion}
              onChange={(e) => s.setForceReducedMotion(e.target.checked)}
            />
            Reduced motion
          </label>
          <button onClick={toggleMic} aria-pressed={mic === "on"}>
            {mic === "on" ? "Stop mic test" : "Mic test"}
          </button>
          {mic === "error" ? <span className="lab__err">Mic unavailable or denied</span> : null}
        </fieldset>
      </section>
    </main>
  );
}
