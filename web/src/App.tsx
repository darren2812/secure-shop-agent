import { useEffect, useState } from "react";
import { Home } from "./pages/Home";
import { OrbLab } from "./pages/OrbLab";

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

  return route.startsWith("/orb-lab") ? <OrbLab /> : <Home />;
}
