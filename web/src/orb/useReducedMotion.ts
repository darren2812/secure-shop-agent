import { useEffect, useState } from "react";
import { useOrbStore } from "./store";

/** OS prefers-reduced-motion OR the orb-lab override. */
export function useOrbReducedMotion(): boolean {
  const forced = useOrbStore((s) => s.forceReducedMotion);
  const [os, setOs] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setOs(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return forced || os;
}
