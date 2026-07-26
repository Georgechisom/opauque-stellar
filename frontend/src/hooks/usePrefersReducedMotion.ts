import { useEffect, useState } from "react";
import { useMotionStore } from "../store/motionStore";

const QUERY = "(prefers-reduced-motion: reduce)";

function getSystemPreference(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Resolves whether motion should be reduced right now (#550): the OS-level
 * `prefers-reduced-motion` media query is honored by default, but an explicit
 * in-app override (set via the Motion settings toggle) wins in either direction.
 */
export function usePrefersReducedMotion(): boolean {
  const override = useMotionStore((s) => s.reducedMotionOverride);
  const [systemPreference, setSystemPreference] = useState(getSystemPreference);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    const onChange = () => setSystemPreference(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return override ?? systemPreference;
}
