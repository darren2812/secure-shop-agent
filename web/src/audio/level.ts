import { useOrbStore } from "../orb/store";

const ATTACK = 0.5;
const RELEASE = 0.1;
/** Speech RMS rarely exceeds ~0.3 of full scale; scale up so the orb visibly reacts. */
const GAIN = 3.5;

/**
 * Meter a MediaStream (mic track while listening, remote voice track while
 * speaking) and write a smoothed 0..1 RMS into the orb store every frame.
 * Returns detach(), which stops metering, closes the AudioContext and resets
 * level to 0. It does NOT stop the stream's tracks — the caller owns them.
 */
export function attachLevelMeter(stream: MediaStream): () => void {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const buf = new Float32Array(analyser.fftSize);
  const setLevel = useOrbStore.getState().setLevel;
  let smoothed = 0;
  let raf = 0;
  let alive = true;

  void ctx.resume();

  const tick = () => {
    if (!alive) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.min(1, Math.sqrt(sum / buf.length) * GAIN);
    const k = rms > smoothed ? ATTACK : RELEASE;
    smoothed += (rms - smoothed) * k;
    setLevel(smoothed);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    source.disconnect();
    void ctx.close();
    setLevel(0);
  };
}
