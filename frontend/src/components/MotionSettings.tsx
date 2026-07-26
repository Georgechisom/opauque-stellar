/**
 * In-app motion preference toggle (#550).
 *
 * OS-level `prefers-reduced-motion` is honored by default ("Match system"). The
 * two explicit options let the user override it in either direction, applied
 * app-wide via `usePrefersReducedMotion` / the CSS switch in index.css.
 */

import { useMotionStore } from "../store/motionStore";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

type MotionOption = "system" | "on" | "off";

const OPTIONS: { value: MotionOption; label: string }[] = [
  { value: "system", label: "Match system setting" },
  { value: "on", label: "Always reduce motion" },
  { value: "off", label: "Always allow motion" },
];

function toOption(override: boolean | null): MotionOption {
  if (override === null) return "system";
  return override ? "on" : "off";
}

function fromOption(value: MotionOption): boolean | null {
  if (value === "on") return true;
  if (value === "off") return false;
  return null;
}

export function MotionSettings() {
  const override = useMotionStore((s) => s.reducedMotionOverride);
  const setOverride = useMotionStore((s) => s.setReducedMotionOverride);
  const effective = usePrefersReducedMotion();
  const selected = toOption(override);

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-900/60 p-5">
      <h3 className="text-lg font-semibold text-white">Motion</h3>
      <p className="mt-1 max-w-prose text-sm leading-relaxed text-mist/70">
        Controls whether transitions and progress animations play. Progress
        indicators (like proof generation) stay functional either way — only the
        animation is affected.
      </p>

      <fieldset className="mt-4 space-y-2">
        <legend className="sr-only">Motion preference</legend>
        {OPTIONS.map((opt) => (
          <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm text-white">
            <input
              type="radio"
              name="motion-preference"
              value={opt.value}
              checked={selected === opt.value}
              onChange={() => setOverride(fromOption(opt.value))}
              className="h-4 w-4 accent-glow"
            />
            {opt.label}
          </label>
        ))}
      </fieldset>

      <p className="mt-3 text-xs text-mist/60">
        Currently {effective ? "reducing" : "allowing"} motion.
      </p>
    </div>
  );
}
