import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring, useTransform, type Variants } from "motion/react";
import { useOrbStore, type AgentState, type Tier } from "./store";
import { useOrbReducedMotion } from "./useReducedMotion";

/**
 * Eye expression. Active agent behaviors (listening, scanning) win; otherwise
 * the API tier decides; otherwise idle/speaking.
 * Each tier has a distinct SHAPE cue so it reads without color:
 *  trusted  → calm eyes, slow nod, small check mark
 *  caution  → one raised eyebrow, head tilt
 *  blocked  → narrowed flat-topped eyes glaring at the store card, shield outline
 *  verify   → round open eyes looking at a lock glyph
 */
export type EyeMode = AgentState | Exclude<Tier, null>;

export function eyeModeFor(agentState: AgentState, tier: Tier): EyeMode {
  if (agentState === "listening" || agentState === "scanning") return agentState;
  if (tier) return tier;
  return agentState;
}

// viewBox 0..200, orb center (100,100), body radius ≈ 62.
const EYE_W = 22;
const EYE_H = 32;
const EYE_Y = 92; // eye center y
const LEFT_X = 79;
const RIGHT_X = 121;
const PUPIL_MAX = 6;
const LOCK_POS = { x: 9, y: 9 }; // pupil offset toward the lock glyph (bottom-right)

type Custom = { px: number; py: number; reduced: boolean; look: { x: number; y: number } };

const eyeShape: Variants = {
  idle: { height: EYE_H, attrY: EYE_Y - EYE_H / 2, rx: 11 },
  listening: { height: EYE_H + 6, attrY: EYE_Y - (EYE_H + 6) / 2, rx: 11 },
  scanning: { height: EYE_H * 0.45, attrY: EYE_Y - (EYE_H * 0.45) / 2, rx: 7 },
  speaking: { height: EYE_H, attrY: EYE_Y - EYE_H / 2, rx: 11 },
  trusted: { height: EYE_H - 6, attrY: EYE_Y - (EYE_H - 6) / 2 + 2, rx: 11 },
  caution: { height: EYE_H, attrY: EYE_Y - EYE_H / 2, rx: 11 },
  // Narrowed + nearly square corners = "firm", clearly not a squint.
  blocked: { height: EYE_H * 0.42, attrY: EYE_Y - (EYE_H * 0.42) / 2 + 3, rx: 3 },
  verify: { height: EYE_H + 4, attrY: EYE_Y - (EYE_H + 4) / 2, rx: 11 },
};

const pupil: Variants = {
  idle: { x: 0, y: 0 },
  listening: (c: Custom) => ({ x: c.px, y: c.py }),
  scanning: (c: Custom) =>
    c.reduced
      ? { x: 0, y: 0 }
      : {
          x: [-PUPIL_MAX, PUPIL_MAX, -PUPIL_MAX],
          y: 0,
          transition: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
        },
  speaking: { x: 0, y: 0 },
  trusted: { x: 0, y: 3 },
  caution: { x: 2, y: -1 },
  // Narrowed eye is short: keep the glare mostly horizontal so the pupil stays inside.
  blocked: (c: Custom) => ({ x: c.look.x, y: 3 + Math.max(-1.5, Math.min(1.5, c.look.y * 0.25)) }),
  verify: { x: LOCK_POS.x * 0.4, y: LOCK_POS.y * 0.5 },
};

const head: Variants = {
  idle: { rotate: 0, y: 0, x: 0 },
  listening: (c: Custom) => ({ rotate: 0, x: c.px * 0.5, y: c.py * 0.5 }),
  scanning: { rotate: 0, y: 0, x: 0 },
  speaking: { rotate: 0, y: 0, x: 0 },
  trusted: (c: Custom) =>
    c.reduced
      ? { rotate: 0, x: 0, y: 0 }
      : { rotate: 0, x: 0, y: [0, 5, 0], transition: { duration: 2.4, repeat: Infinity, repeatDelay: 1.2, ease: "easeInOut" } },
  caution: { rotate: -7, y: 0, x: 0 },
  blocked: (c: Custom) => ({ rotate: 0, x: c.look.x * 0.4, y: c.look.y * 0.4 }),
  verify: { rotate: 4, x: 2, y: 2 },
};

const fadeIn: Variants = { off: { opacity: 0, scale: 0.6 }, on: { opacity: 1, scale: 1 } };

interface EyesProps {
  /** Unit-ish direction of the store card from the orb; default: below. */
  storeCardDirection?: { x: number; y: number };
}

export function Eyes({ storeCardDirection = { x: 0.3, y: 1 } }: EyesProps) {
  const agentState = useOrbStore((s) => s.agentState);
  const tier = useOrbStore((s) => s.tier);
  const reduced = useOrbReducedMotion();
  const mode = eyeModeFor(agentState, tier);
  const svgRef = useRef<SVGSVGElement>(null);

  // Pointer tracking (listening only).
  const [ptr, setPtr] = useState({ px: 0, py: 0 });
  useEffect(() => {
    if (mode !== "listening") return;
    const onMove = (e: PointerEvent) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const m = Math.min(1, d / 300) * PUPIL_MAX;
      setPtr({ px: (dx / d) * m, py: (dy / d) * m });
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [mode]);

  // Random blink every 3–6 s in calm modes.
  const [blink, setBlink] = useState(false);
  const canBlink = !reduced && (mode === "idle" || mode === "speaking" || mode === "trusted" || mode === "listening");
  useEffect(() => {
    if (!canBlink) return;
    let t1: number, t2: number;
    const schedule = () => {
      t1 = window.setTimeout(() => {
        setBlink(true);
        t2 = window.setTimeout(() => {
          setBlink(false);
          schedule();
        }, 120);
      }, 3000 + Math.random() * 3000);
    };
    schedule();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      setBlink(false);
    };
  }, [canBlink]);

  // Speaking: eyes squash slightly with output level.
  const levelMv = useMotionValue(0);
  useEffect(
    () => useOrbStore.subscribe((s) => levelMv.set(s.agentState === "speaking" && !reduced ? s.level : 0)),
    [levelMv, reduced],
  );
  const levelSpring = useSpring(levelMv, { stiffness: 400, damping: 30 });
  const talkScale = useTransform(levelSpring, (l) => 1 - l * 0.18);

  const look = { x: storeCardDirection.x, y: storeCardDirection.y };
  const ln = Math.hypot(look.x, look.y) || 1;
  const custom: Custom = {
    px: ptr.px,
    py: ptr.py,
    reduced,
    look: { x: (look.x / ln) * PUPIL_MAX, y: (look.y / ln) * PUPIL_MAX },
  };

  const spring = reduced ? { duration: 0 } : { type: "spring" as const, stiffness: 260, damping: 22 };
  const eyeBox = { transformBox: "fill-box" as const, transformOrigin: "center" };

  const renderEye = (cx: number, key: string) => (
    <motion.g key={key} style={{ ...eyeBox, scaleY: talkScale }}>
      <motion.g animate={{ scaleY: blink ? 0.1 : 1 }} transition={{ duration: 0.06 }} style={eyeBox}>
        <motion.rect
          x={cx - EYE_W / 2}
          width={EYE_W}
          fill="#F8FAFF"
          variants={eyeShape}
          initial={false}
          animate={mode}
          transition={spring}
        />
        <motion.circle
          cx={cx}
          cy={EYE_Y}
          r={mode === "blocked" || mode === "scanning" ? 5 : 7}
          fill="#0B1020"
          variants={pupil}
          custom={custom}
          initial={false}
          animate={mode}
          transition={spring}
        />
      </motion.g>
    </motion.g>
  );

  return (
    <svg ref={svgRef} className="orb-eyes" viewBox="0 0 200 200" aria-hidden="true" data-eyes={mode}>
      {/* Blocked: shield outline around the orb (shape cue beyond the red halo). */}
      <motion.path
        d="M100 18 L162 40 V96 C162 140 134 168 100 184 C66 168 38 140 38 96 V40 Z"
        fill="none"
        stroke="#EF4444"
        strokeWidth={3}
        strokeLinejoin="round"
        variants={fadeIn}
        initial={false}
        animate={mode === "blocked" ? "on" : "off"}
        transition={spring}
        style={{ transformOrigin: "100px 100px" }}
      />

      <motion.g variants={head} custom={custom} initial={false} animate={mode} transition={spring}
        style={{ transformOrigin: "100px 100px" }}>
        {renderEye(LEFT_X, "l")}
        {renderEye(RIGHT_X, "r")}

        {/* Caution: one raised eyebrow over the right eye. */}
        <motion.path
          d={`M${RIGHT_X - 13} ${EYE_Y - 26} Q${RIGHT_X} ${EYE_Y - 36} ${RIGHT_X + 13} ${EYE_Y - 28}`}
          stroke="#1A1306"
          strokeWidth={4.5}
          strokeLinecap="round"
          fill="none"
          variants={{ off: { opacity: 0, y: 6 }, on: { opacity: 1, y: 0 } }}
          initial={false}
          animate={mode === "caution" ? "on" : "off"}
          transition={spring}
        />
      </motion.g>

      {/* Trusted: small check mark (no smile). */}
      <motion.path
        d="M88 128 L97 137 L114 118"
        stroke="#F8FAFF"
        strokeWidth={5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        initial={false}
        animate={mode === "trusted" ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
        transition={reduced ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
      />

      {/* Verify: lock glyph the eyes look at. */}
      <motion.g
        variants={fadeIn}
        initial={false}
        animate={mode === "verify" ? "on" : "off"}
        transition={spring}
        style={{ transformOrigin: "128px 136px" }}
      >
        <path d="M121 131 V125 a7 7 0 0 1 14 0 V131" stroke="#F8FAFF" strokeWidth={3.5} fill="none" />
        <rect x={117} y={130} width={22} height={17} rx={4} fill="#F8FAFF" />
        <circle cx={128} cy={138} r={2.6} fill="#4C2A99" />
      </motion.g>
    </svg>
  );
}
