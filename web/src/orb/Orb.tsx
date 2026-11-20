import { useEffect, useRef, useState } from "react";
import { FRAG, VERT } from "./shader";
import { hexToRgb, orbHex } from "./colors";
import { useOrbStore, type AgentState } from "./store";
import { useOrbReducedMotion } from "./useReducedMotion";
import { Eyes } from "./Eyes";

/** Target motion params per agent state; level is added live each frame. */
const STATE_PARAMS: Record<AgentState, { turbulence: number; spin: number }> = {
  idle: { turbulence: 0.12, spin: 0.08 },
  listening: { turbulence: 0.35, spin: 0.2 },
  scanning: { turbulence: 0.55, spin: 1.6 },
  speaking: { turbulence: 0.3, spin: 0.25 },
};

const DPR_CAP = 2;

interface OrbProps {
  /** CSS size in px (spec: 280–360). */
  size?: number;
  /** Tap / Space on the orb: push-to-talk or mute toggle. */
  onToggle?: () => void;
  /** Where the store card sits relative to the orb; blocked eyes glare that way. */
  storeCardDirection?: { x: number; y: number };
}

function hasWebGL2(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

export function Orb({ size = 320, onToggle, storeCardDirection }: OrbProps) {
  const [webgl] = useState(hasWebGL2);
  const agentState = useOrbStore((s) => s.agentState);
  const tier = useOrbStore((s) => s.tier);

  return (
    <button
      type="button"
      className="orb"
      onClick={onToggle}
      aria-label={agentState === "listening" ? "Stop listening" : "Tap to talk"}
      aria-pressed={agentState === "listening"}
      style={{ width: size, height: size }}
      data-state={agentState}
      data-tier={tier ?? "none"}
    >
      {webgl ? <OrbCanvas size={size} /> : <OrbFallback />}
      <Eyes storeCardDirection={storeCardDirection} />
    </button>
  );
}

function OrbCanvas({ size }: { size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useOrbReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true, alpha: true });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("[orb] shader error", gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("[orb] link error", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = {
      res: gl.getUniformLocation(prog, "u_res"),
      time: gl.getUniformLocation(prog, "u_time"),
      level: gl.getUniformLocation(prog, "u_level"),
      color: gl.getUniformLocation(prog, "u_color"),
      turbulence: gl.getUniformLocation(prog, "u_turbulence"),
      spin: gl.getUniformLocation(prog, "u_spin"),
      glow: gl.getUniformLocation(prog, "u_glow"),
    };

    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);

    // Live (smoothed) values.
    const init = useOrbStore.getState();
    const color = hexToRgb(orbHex(init.tier, init.agentState));
    const colorVel: [number, number, number] = [0, 0, 0];
    let turbulence = STATE_PARAMS[init.agentState].turbulence;
    let spin = STATE_PARAMS[init.agentState].spin;
    let glow = init.tier === "blocked" ? 1 : 0;
    let phase = 0; // integrated rotation angle so spin changes never jump
    let shaderTime = 0;

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const s = useOrbStore.getState();
      const reducedNow = reducedRef.current;

      // Color: critically damped spring, settles in ~400 ms.
      const target = hexToRgb(orbHex(s.tier, s.agentState));
      const omega = 14; // rad/s → ~400 ms settle
      for (let i = 0; i < 3; i++) {
        const x = color[i] - target[i];
        const a = -omega * omega * x - 2 * omega * colorVel[i];
        colorVel[i] += a * dt;
        color[i] += colorVel[i] * dt;
      }

      const p = STATE_PARAMS[s.agentState];
      const lvl = s.agentState === "listening" || s.agentState === "speaking" ? s.level : 0;
      const tTarget = reducedNow ? 0 : Math.min(1, p.turbulence + lvl * 0.5);
      const sTarget = reducedNow ? 0 : p.spin;
      const gTarget = s.tier === "blocked" ? 1 : 0;
      const k = 1 - Math.exp(-dt * 6);
      turbulence += (tTarget - turbulence) * k;
      spin += (sTarget - spin) * k;
      glow += (gTarget - glow) * k;

      // u_time is "flow time": agitated states flow faster. Rotation angle is
      // integrated separately so spin changes never make the orb jump.
      shaderTime += reducedNow ? 0 : dt * (0.5 + turbulence * 1.5);
      phase += spin * dt;

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, shaderTime);
      gl.uniform1f(u.level, reducedNow ? 0 : lvl);
      gl.uniform3f(u.color, color[0], color[1], color[2]);
      gl.uniform1f(u.turbulence, turbulence);
      // Shader angle = u_time * u_spin, so pass the spin that yields `phase`.
      gl.uniform1f(u.spin, shaderTime > 0 ? phase / shaderTime : 0);
      gl.uniform1f(u.glow, glow);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      raf = requestAnimationFrame(frame);
    };

    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    document.addEventListener("visibilitychange", onVis);
    if (!document.hidden) start();

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVis);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
    };
  }, [size]);

  return <canvas ref={canvasRef} className="orb-canvas" style={{ width: size, height: size }} aria-hidden="true" />;
}

/** No WebGL2: CSS radial gradient + blur + level-driven scale, same colors. */
function OrbFallback() {
  const tier = useOrbStore((s) => s.tier);
  const level = useOrbStore((s) => s.level);
  const agentState = useOrbStore((s) => s.agentState);
  const reduced = useOrbReducedMotion();
  const hex = orbHex(tier, agentState);
  const scale = reduced ? 1 : 1 + level * 0.08;
  return (
    <div
      className={`orb-fallback${reduced ? "" : " orb-fallback--breathe"}`}
      aria-hidden="true"
      style={{
        background: `radial-gradient(circle at 38% 34%, color-mix(in srgb, ${hex} 55%, white) 0%, ${hex} 40%, color-mix(in srgb, ${hex} 40%, black) 78%, transparent 80%)`,
        boxShadow: `0 0 60px 10px color-mix(in srgb, ${hex} 45%, transparent)${
          tier === "blocked" ? `, 0 0 0 18px rgba(239,68,68,0.18), 0 0 0 20px rgba(239,68,68,0.6)` : ""
        }`,
        transform: `scale(${scale})`,
      }}
    />
  );
}
