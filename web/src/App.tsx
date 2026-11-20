import { useEffect, useState } from "react";
import { Home } from "./pages/Home";
import { OrbLab } from "./pages/OrbLab";
import { Attack } from "./pages/Attack";
import { Autopilot } from "./demo/Autopilot";
import { useAutopilot } from "./demo/controller";

/** Tiny hash router: "#/" → Home, "#/orb-lab" → OrbLab. Also accepts path /orb-lab. */
function currentRoute(): string {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash) return hash;
  return window.location.pathname;
}

export function App() {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const on = () => setRoute(currentRoute());
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    return () => {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
    };
  }, []);

  // Fixed slots: Home keeps its state while the demo autopilot shows #/attack (hidden, display:none).
  // Without the autopilot this is the old behavior: one page per route.
  const keepHome = useAutopilot((s) => s.keepHome);
  const isLab = route.startsWith("/orb-lab");
  const isAttack = route.startsWith("/attack");
  const onHome = !isLab && !isAttack;
  return (
    <>
      {onHome || keepHome ? <div style={{ display: onHome ? "contents" : "none" }}><Home /></div> : null}
      {isLab ? <OrbLab /> : null}
      {isAttack ? <Attack /> : null}
      <Autopilot />
    </>
  );
}
