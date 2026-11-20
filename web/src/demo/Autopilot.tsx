import { useEffect } from "react";
import { arm, disarm, runNext, STEP_COUNT, useAutopilot } from "./controller";

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

/** Hidden demo trigger: a tiny low-opacity dot, only after Shift+D or `?autopilot=1`. Renders nothing otherwise. */
export function Autopilot() {
  const { armed, done, run, error } = useAutopilot();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("autopilot") === "1") arm();
    const on = (e: KeyboardEvent) => {
      const st = useAutopilot.getState();
      if (e.key === "D" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target)) {
        e.preventDefault();
        if (st.armed) disarm(); else arm();
        return;
      }
      if (!st.armed) return;
      if (e.key === "Escape") { disarm(); return; }
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        if (e.key === " " && isTyping(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        void runNext();
      }
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, []);

  if (!armed) return null;
  const finished = done >= STEP_COUNT;
  const label = run === "error" ? `⚠ ${done + 1}/${STEP_COUNT} ${error}` : run === "running" ? `● ${done + 1}/${STEP_COUNT}` : finished ? "✓ done" : `▶ ${done + 1}/${STEP_COUNT}`;
  return (
    <button type="button" className="autopilot-dot" aria-label="Demo autopilot: next step" onClick={() => (finished ? disarm() : void runNext())}>
      {label}
    </button>
  );
}
