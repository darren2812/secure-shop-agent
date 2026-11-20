import { useEffect, useId, useRef, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type AnimationPlaybackControls,
  type Variants,
} from "motion/react";
import { orbHex } from "./colors";
import { useOrbStore, type AgentState, type Tier } from "./store";
import { useOrbReducedMotion } from "./useReducedMotion";

/**
 * Eye expression. Active agent behaviors (listening, scanning) win; otherwise
 * the API tier decides; otherwise idle/speaking.
 * Each tier has a distinct SHAPE cue so it reads without color:
 *  trusted  → calm half-lidded eyes, slow nod, check badge (no smile, no mouth)
 *  caution  → one raised luminous eyebrow, asymmetric lids, head tilt
 *  blocked  → narrowed flat slits looking at the store card, shield badge (no brows)
 *  verify   → wide open round eyes looking at a lock badge
 */
export type EyeMode = AgentState | Exclude<Tier, null>;

export function eyeModeFor(agentState: AgentState, tier: Tier): EyeMode {
  if (agentState === "listening" || agentState === "scanning")
    return agentState;
  if (tier) return tier;
  return agentState;
}

// ── Proportions ────────────────────────────────────────────────────────────
// viewBox 0..200, orb center (100,100), shader body radius R ≈ 62.
// Everything derives from R and φ so the face sits in the orb like it belongs.
const PHI = 1.618;
const R = 62;
const EYE_H = Math.round(R * 0.45); // 28
const EYE_W = Math.round(EYE_H / PHI); // 17  (w:h ≈ 1:φ)
const EYE_GAP = Math.round(R / PHI); // 38  center-to-center
const EYE_Y = Math.round(100 - R / PHI ** 4); // 91  slightly above center
const LEFT_X = 100 - EYE_GAP / 2;
const RIGHT_X = 100 + EYE_GAP / 2;
const GAZE_X = 9;
const GAZE_Y = 7;
// Glyph badges sit on the orb at 45° lower-right, never where a mouth would be.
const BADGE = { x: Math.round(100 + R * 0.6), y: Math.round(100 + R * 0.6) }; // (137,137)
const LOCK_DIR = { x: 0.72, y: 0.7 };

/** w/h in px, rx corner, lid = fraction of the eye hidden by the top lid. */
type Shape = { w: number; h: number; rx: number; lid: number };
const S = (w: number, h: number, rx: number, lid = 0): Shape => ({
  w,
  h,
  rx,
  lid,
});

const SHAPES: Record<EyeMode, [Shape, Shape]> = {
  idle: [S(EYE_W, EYE_H, EYE_W / 2), S(EYE_W, EYE_H, EYE_W / 2)],
  listening: [
    S(EYE_W + 1, EYE_H + 4, (EYE_W + 1) / 2),
    S(EYE_W + 1, EYE_H + 4, (EYE_W + 1) / 2),
  ],
  // Soft rounded squint (pill) — distinct from blocked's hard-edged slit.
  scanning: [S(EYE_W + 3, 9, 4.5), S(EYE_W + 3, 9, 4.5)],
  speaking: [S(EYE_W, EYE_H, EYE_W / 2), S(EYE_W, EYE_H, EYE_W / 2)],
  // Calm: relaxed upper lids (flat top), not a smile.
  trusted: [S(EYE_W, EYE_H, EYE_W / 2, 0.36), S(EYE_W, EYE_H, EYE_W / 2, 0.36)],
  // Skeptical asymmetry: left lid slightly lowered, right eye opened under the raised brow.
  caution: [
    S(EYE_W, EYE_H - 2, EYE_W / 2, 0.22),
    S(EYE_W + 1, EYE_H + 3, (EYE_W + 1) / 2),
  ],
  // Firm: wide, short, nearly square-cornered slits.
  blocked: [S(EYE_W + 5, 8, 1.6), S(EYE_W + 5, 8, 1.6)],
  // Alert: round and open.
  verify: [
    S(EYE_W + 4, EYE_H + 2, (EYE_W + 4) / 2),
    S(EYE_W + 4, EYE_H + 2, (EYE_W + 4) / 2),
  ],
};

const CALM: EyeMode[] = ["idle", "speaking", "trusted", "listening", "caution"];

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) =>
    Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(16)}${ch(8)}${ch(0)}`;
}

const head: Variants = {
  idle: { rotate: 0, y: 0 },
  listening: { rotate: 0, y: -1 },
  scanning: { rotate: 0, y: 0 },
  speaking: { rotate: 0, y: 0 },
  trusted: (reduced: boolean) =>
    reduced
      ? { rotate: 0, y: 0 }
      : {
          rotate: 0,
          y: [0, 4, 0],
          transition: {
            duration: 2.6,
            times: [0, 0.45, 1],
            repeat: Infinity,
            repeatDelay: 1.6,
            ease: "easeInOut",
          },
        },
  caution: { rotate: -7, y: 0 },
  blocked: { rotate: 0, y: 1 },
  verify: { rotate: 4, y: 0 },
};

const badgeIn: Variants = {
  off: { opacity: 0, scale: 0.4 },
  on: { opacity: 1, scale: 1 },
};

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
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const id = (n: string) => `eyes-${uid}-${n}`;

  const tint = orbHex(tier, agentState);
  const rim = mixHex(tint, "#FFFFFF", 0.5);
  const glow = mixHex(tint, "#FFFFFF", 0.3);

  // ── Gaze: slow organic spring for intent, stiff spring for micro-saccades ──
  const gazeX = useMotionValue(0);
  const gazeY = useMotionValue(0);
  const sacX = useMotionValue(0);
  const sacY = useMotionValue(0);
  const sweep = useMotionValue(0);
  const gx = useSpring(gazeX, { stiffness: 150, damping: 17, mass: 0.9 });
  const gy = useSpring(gazeY, { stiffness: 150, damping: 17, mass: 0.9 });
  const sx = useSpring(sacX, { stiffness: 900, damping: 42 });
  const sy = useSpring(sacY, { stiffness: 900, damping: 42 });
  const eyeX = useTransform(() => gx.get() + sx.get() + sweep.get());
  const eyeY = useTransform(() => gy.get() + sy.get());
  // Face follows the gaze a little (head turn); specular counter-moves (glassy depth).
  const faceX = useTransform(eyeX, (v) => v * 0.35);
  const faceY = useTransform(eyeY, (v) => v * 0.35);
  const specX = useTransform(eyeX, (v) => -v * 0.2);
  const specY = useTransform(eyeY, (v) => -v * 0.2);

  const look = (() => {
    const l = Math.hypot(storeCardDirection.x, storeCardDirection.y) || 1;
    return { x: storeCardDirection.x / l, y: storeCardDirection.y / l };
  })();

  // Intent gaze per mode.
  useEffect(() => {
    const set = (x: number, y: number) => {
      gazeX.set(x);
      gazeY.set(y);
      if (reduced) {
        gx.jump(x);
        gy.jump(y);
      }
    };
    switch (mode) {
      case "blocked":
        return set(look.x * GAZE_X, look.y * GAZE_Y * 0.6);
      case "verify":
        return set(LOCK_DIR.x * GAZE_X, LOCK_DIR.y * GAZE_Y);
      case "trusted":
        return set(0, 2);
      case "caution":
        return set(2.5, -1);
      case "listening":
        return; // pointer drives it
      default:
        return set(0, 0);
    }
  }, [mode, reduced, look.x, look.y, gazeX, gazeY, gx, gy]);

  // Listening: eyes follow the pointer (no React re-render per move).
  useEffect(() => {
    if (mode !== "listening") return;
    const onMove = (e: PointerEvent) => {
      const el = svgRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const m = Math.min(1, d / 320);
      gazeX.set((dx / d) * m * GAZE_X);
      gazeY.set((dy / d) * m * GAZE_Y);
      if (reduced) {
        gx.jump(gazeX.get());
        gy.jump(gazeY.get());
      }
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [mode, reduced, gazeX, gazeY, gx, gy]);

  // Micro-saccades: tiny quick fixation shifts, the cue that something is "alive".
  useEffect(() => {
    if (reduced || !CALM.includes(mode)) {
      sacX.set(0);
      sacY.set(0);
      return;
    }
    let t: number;
    const tick = () => {
      const home = Math.random() < 0.35;
      sacX.set(home ? 0 : (Math.random() * 2 - 1) * 1.6);
      sacY.set(home ? 0 : (Math.random() * 2 - 1) * 1.0);
      t = window.setTimeout(tick, 700 + Math.random() * 1800);
    };
    t = window.setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, [mode, reduced, sacX, sacY]);

  // Scanning: eased left↔right sweep.
  useEffect(() => {
    let c: AnimationPlaybackControls | undefined;
    if (mode === "scanning" && !reduced) {
      c = animate(sweep, [-GAZE_X, GAZE_X], {
        duration: 0.95,
        repeat: Infinity,
        repeatType: "mirror",
        ease: [0.65, 0, 0.35, 1],
      });
    } else {
      c = animate(
        sweep,
        0,
        reduced
          ? { duration: 0 }
          : { type: "spring", stiffness: 200, damping: 20 },
      );
    }
    return () => c?.stop();
  }, [mode, reduced, sweep]);

  // ── Blink: squash & stretch, right eye lags a hair, occasional double ──
  const lBlink = useRef<SVGGElement>(null);
  const rBlink = useRef<SVGGElement>(null);
  const blink = (depth = 0.06) => {
    const kf = {
      scaleY: [1, depth, 1],
      scaleX: [1, 1 + (1 - depth) * 0.12, 1],
    };
    const tr: Parameters<typeof animate>[2] = {
      duration: 0.2,
      times: [0, 0.38, 1],
      ease: ["easeIn", "easeOut"],
    };
    if (lBlink.current) animate(lBlink.current, kf, tr);
    if (rBlink.current) animate(rBlink.current, kf, { ...tr, delay: 0.028 });
  };

  const canBlink = !reduced && CALM.includes(mode);
  useEffect(() => {
    if (!canBlink) return;
    let t: number;
    const schedule = () => {
      t = window.setTimeout(
        () => {
          blink();
          if (Math.random() < 0.18) window.setTimeout(() => blink(), 260);
          schedule();
        },
        3000 + Math.random() * 3000,
      );
    };
    schedule();
    return () => clearTimeout(t);
  }, [canBlink]);

  // Anticipation: a half-blink right as attention shifts to a new state.
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current !== mode && !reduced) blink(0.45);
    prevMode.current = mode;
  }, [mode, reduced]);

  // Speaking: eyes squash gently with output level.
  const levelMv = useMotionValue(0);
  useEffect(
    () =>
      useOrbStore.subscribe((s) =>
        levelMv.set(s.agentState === "speaking" && !reduced ? s.level : 0),
      ),
    [levelMv, reduced],
  );
  const levelSpring = useSpring(levelMv, { stiffness: 420, damping: 28 });
  const talkScaleY = useTransform(levelSpring, (l) => 1 - l * 0.2);
  const talkScaleX = useTransform(levelSpring, (l) => 1 + l * 0.06);

  const spring = reduced
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 240, damping: 20, mass: 0.9 };
  const box = { transformBox: "fill-box" as const, transformOrigin: "center" };

  const renderEye = (cx: number, side: 0 | 1) => {
    const s = SHAPES[mode][side];
    const top = EYE_Y - s.h / 2;
    const lidY = top + s.h * s.lid;
    const showSpec = s.h > 14 && s.lid < 0.3;
    return (
      <motion.g key={side} style={{ x: eyeX, y: eyeY }}>
        {/* Socket shade: keeps contrast on the brightest parts of the shader. */}
        <motion.ellipse
          cx={cx}
          cy={EYE_Y}
          fill="#070B1C"
          opacity={0.38}
          filter={`url(#${id("soft")})`}
          initial={false}
          animate={{ rx: s.w / 2 + 5, ry: s.h / 2 + 5 }}
          transition={spring}
        />
        <motion.g ref={side ? rBlink : lBlink} style={box}>
          <motion.g style={{ ...box, scaleY: talkScaleY, scaleX: talkScaleX }}>
            <clipPath id={id(`lid${side}`)}>
              <motion.rect
                x={cx - 30}
                width={60}
                height={80}
                initial={false}
                animate={{ attrY: lidY }}
                transition={spring}
              />
            </clipPath>
            {/* Bloom applied after the lid clip so the glow stays soft at the lid. */}
            <g filter={`url(#${id("glow")})`}>
              <g clipPath={`url(#${id(`lid${side}`)})`}>
                <motion.rect
                  fill={`url(#${id("body")})`}
                  initial={false}
                  animate={{
                    attrX: cx - s.w / 2,
                    attrY: top,
                    width: s.w,
                    height: s.h,
                    rx: s.rx,
                  }}
                  transition={spring}
                />
                <motion.ellipse
                  fill="#FFFFFF"
                  style={{ x: specX, y: specY }}
                  initial={false}
                  animate={{
                    cx: cx - s.w * 0.2,
                    cy: top + Math.min(s.h * 0.24, 7),
                    rx: s.w * 0.13,
                    ry: Math.min(s.h * 0.11, 3.2),
                    opacity: showSpec ? 0.95 : 0,
                  }}
                  transition={spring}
                />
              </g>
            </g>
            {/* Lid edge: a faint luminous line where the calm lid sits. */}
            <motion.line
              x1={cx - s.w / 2 + 1}
              x2={cx + s.w / 2 - 1}
              stroke={rim}
              strokeWidth={1.2}
              strokeLinecap="round"
              initial={false}
              animate={{ y1: lidY, y2: lidY, opacity: s.lid > 0.05 ? 0.7 : 0 }}
              transition={spring}
            />
          </motion.g>
        </motion.g>
      </motion.g>
    );
  };

  const glyphStroke = {
    stroke: "#FFFFFF",
    strokeWidth: 2.2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
    filter: `url(#${id("line")})`,
  };
  const drawIn = (on: boolean, delay = 0.12) => ({
    initial: false as const,
    animate: on ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 },
    transition: reduced
      ? { duration: 0 }
      : {
          duration: 0.55,
          delay: on ? delay : 0,
          ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        },
  });

  const badge = (on: boolean, children: ReactNode) => (
    <motion.g
      variants={badgeIn}
      initial={false}
      animate={on ? "on" : "off"}
      transition={spring}
      style={{ transformOrigin: `${BADGE.x}px ${BADGE.y}px` }}
    >
      <circle
        cx={BADGE.x}
        cy={BADGE.y}
        r={14}
        fill="#070B1C"
        opacity={0.42}
        filter={`url(#${id("soft")})`}
      />
      <circle
        cx={BADGE.x}
        cy={BADGE.y}
        r={12.5}
        {...glyphStroke}
        strokeWidth={1.2}
        opacity={0.55}
      />
      {children}
    </motion.g>
  );

  const { x: bx, y: by } = BADGE;

  return (
    <svg
      ref={svgRef}
      className="orb-eyes"
      viewBox="0 0 200 200"
      aria-hidden="true"
      data-eyes={mode}
    >
      <defs>
        {/* Emissive body: hot white core, tier-tinted rim. */}
        <radialGradient
          id={id("body")}
          cx="50%"
          cy="58%"
          r="62%"
          fx="50%"
          fy="62%"
        >
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor="#F4F8FF" />
          <stop offset="100%" stopColor={rim} />
        </radialGradient>
        {/* Two-radius bloom tinted with the tier color. */}
        <filter
          id={id("glow")}
          x="-150%"
          y="-150%"
          width="400%"
          height="400%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="wide" />
          <feFlood floodColor={glow} floodOpacity="0.85" />
          <feComposite in2="wide" operator="in" result="wideGlow" />
          <feGaussianBlur
            in="SourceGraphic"
            stdDeviation="1.4"
            result="tight"
          />
          <feMerge>
            <feMergeNode in="wideGlow" />
            <feMergeNode in="tight" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* Luminous line language for brows and glyphs. */}
        <filter
          id={id("line")}
          x="-60%"
          y="-60%"
          width="220%"
          height="220%"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.4" result="b" />
          <feFlood floodColor={glow} floodOpacity="0.9" />
          <feComposite in2="b" operator="in" result="g" />
          <feMerge>
            <feMergeNode in="g" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id={id("soft")} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
      </defs>

      <motion.g
        variants={head}
        custom={reduced}
        initial={false}
        animate={mode}
        transition={spring}
        style={{ transformOrigin: "100px 100px" }}
      >
        <motion.g style={{ x: faceX, y: faceY }}>
          {renderEye(LEFT_X, 0)}
          {renderEye(RIGHT_X, 1)}

          {/* Caution: one thin luminous raised eyebrow over the right eye. */}
          <motion.g
            initial={false}
            animate={
              mode === "caution" ? { y: 0, opacity: 1 } : { y: 6, opacity: 0 }
            }
            transition={spring}
          >
            <motion.path
              d={`M${RIGHT_X - 11} ${EYE_Y - 19} Q${RIGHT_X - 1} ${EYE_Y - 29} ${RIGHT_X + 11} ${EYE_Y - 23}`}
              {...glyphStroke}
              strokeWidth={2.6}
              {...drawIn(mode === "caution", 0.05)}
            />
          </motion.g>
        </motion.g>
      </motion.g>

      {/* Trusted: check badge. */}
      {badge(
        mode === "trusted",
        <>
          <motion.path
            d={`M${bx - 5.5} ${by + 0.5} L${bx - 1.5} ${by + 4.5} L${bx + 6} ${by - 4.5}`}
            {...glyphStroke}
            {...drawIn(mode === "trusted")}
          />
        </>,
      )}

      {/* Blocked: shield badge (shape cue in addition to the red halo). */}
      {badge(
        mode === "blocked",
        <>
          <motion.path
            d={`M${bx} ${by - 7.5} L${bx + 6} ${by - 5} V${by} C${bx + 6} ${by + 4} ${bx + 3} ${by + 6.5} ${bx} ${by + 8} C${bx - 3} ${by + 6.5} ${bx - 6} ${by + 4} ${bx - 6} ${by} V${by - 5} Z`}
            {...glyphStroke}
            {...drawIn(mode === "blocked")}
          />
          <motion.path
            d={`M${bx - 2.6} ${by - 2} L${bx + 2.6} ${by + 3.2} M${bx + 2.6} ${by - 2} L${bx - 2.6} ${by + 3.2}`}
            {...glyphStroke}
            strokeWidth={1.8}
            {...drawIn(mode === "blocked", 0.4)}
          />
        </>,
      )}

      {/* Verify: lock badge the eyes look at. */}
      {badge(
        mode === "verify",
        <>
          <motion.path
            d={`M${bx - 3.6} ${by - 1} V${by - 4} a3.6 3.6 0 0 1 7.2 0 V${by - 1}`}
            {...glyphStroke}
            {...drawIn(mode === "verify", 0.3)}
          />
          <motion.rect
            x={bx - 6}
            y={by - 1}
            width={12}
            height={9}
            rx={2.2}
            {...glyphStroke}
            {...drawIn(mode === "verify")}
          />
          <motion.circle
            cx={bx}
            cy={by + 3.5}
            r={1.1}
            fill="#FFFFFF"
            initial={false}
            animate={{ opacity: mode === "verify" ? 1 : 0 }}
          />
        </>,
      )}
    </svg>
  );
}
