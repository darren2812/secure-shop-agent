// Voice for the orb.
// Primary: OpenAI GPT-Live 1.1 over WebRTC with client delegation. GPT-Live only talks; when it
// delegates, we send the user's transcript to our backend (`onAsk`) and hand back the code-built
// `say` line. Fallback: browser Web Speech API (no key needed).
// Voice never buys: `onAsk` only hits /api/turn, which has no purchase path.
import { useCallback, useRef, useState } from "react";
import { attachLevelMeter } from "../audio/level";
import { useOrbStore } from "../orb/store";

export type VoiceMode = "off" | "connecting" | "live" | "webspeech" | "error";

type Ask = (text: string) => Promise<string>; // returns the spoken verdict built by the backend

const DEMO_TOKEN = import.meta.env.VITE_DEMO_TOKEN as string | undefined;
const SPEAKING_IDLE_MS = 1200;

let eventSeq = 0;
const eid = (p: string) => `${p}_${Date.now()}_${eventSeq++}`;

export function useVoice(onAsk: Ask) {
  const [mode, setMode] = useState<VoiceMode>("off");
  const [error, setError] = useState("");
  const pc = useRef<RTCPeerConnection | null>(null);
  const dc = useRef<RTCDataChannel | null>(null);
  const mic = useRef<MediaStream | null>(null);
  const detach = useRef<(() => void)[]>([]);
  const heard = useRef(""); // user speech since the last delegation
  const speakingTimer = useRef<number | undefined>(undefined);
  const { setAgentState } = useOrbStore.getState();

  const send = (event: Record<string, unknown>) => {
    if (dc.current?.readyState === "open") dc.current.send(JSON.stringify(event));
  };

  const cleanup = useCallback(() => {
    detach.current.forEach((d) => d());
    detach.current = [];
    mic.current?.getTracks().forEach((t) => t.stop());
    pc.current?.close();
    pc.current = dc.current = mic.current = null;
    window.clearTimeout(speakingTimer.current);
  }, []);

  const handleDelegation = async (delegationId: string) => {
    // Silence the automatic filler acknowledgment while the backend works.
    send({ type: "session.thinking.append", event_id: eid("think"), delegation_id: delegationId, content: "" });
    const text = heard.current.trim();
    heard.current = "";
    setAgentState("scanning");
    let say: string;
    try {
      say = text ? await onAsk(text) : "Sorry, I didn't catch that.";
    } catch {
      say = "Something went wrong checking that. Nothing was bought.";
    }
    send({ type: "session.commentary.append", event_id: eid("say"), delegation_id: delegationId, content: say });
  };

  const onEvent = (raw: string) => {
    let ev: { type?: string; delta?: string; delegation?: { id: string } };
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    switch (ev.type) {
      case "session.started":
        setMode("live");
        setAgentState("listening");
        break;
      case "session.input_transcript.delta":
        heard.current += ev.delta ?? "";
        setAgentState("listening");
        break;
      case "session.delegation.created":
        if (ev.delegation?.id) void handleDelegation(ev.delegation.id);
        break;
      case "session.output_transcript.delta":
        setAgentState("speaking");
        window.clearTimeout(speakingTimer.current);
        speakingTimer.current = window.setTimeout(() => setAgentState("listening"), SPEAKING_IDLE_MS);
        break;
      case "session.closed":
        cleanup();
        setMode("off");
        setAgentState("idle");
        break;
    }
  };

  const startLive = async () => {
    const conn = new RTCPeerConnection();
    pc.current = conn;
    const audio = new Audio();
    audio.autoplay = true;
    conn.addEventListener("track", (e) => {
      const stream = new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      detach.current.push(attachLevelMeter(stream));
    });
    mic.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    mic.current.getAudioTracks().forEach((t) => conn.addTrack(t, mic.current!));
    detach.current.push(attachLevelMeter(mic.current));

    const channel = conn.createDataChannel("oai-events"); // must exist before the offer
    dc.current = channel;
    channel.addEventListener("message", (e) => onEvent(e.data));
    channel.addEventListener("close", () => {
      if (pc.current === conn) {
        cleanup();
        setMode("off");
        setAgentState("idle");
      }
    });

    await conn.setLocalDescription(await conn.createOffer());
    if (conn.iceGatheringState !== "complete") {
      await new Promise<void>((resolve) => {
        const t = window.setTimeout(resolve, 3000);
        conn.addEventListener("icegatheringstatechange", () => {
          if (conn.iceGatheringState === "complete") {
            window.clearTimeout(t);
            resolve();
          }
        });
      });
    }
    const res = await fetch("/api/voice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(DEMO_TOKEN ? { "X-Demo-Token": DEMO_TOKEN } : {}) },
      body: JSON.stringify({ sdp: conn.localDescription?.sdp }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail ?? `Voice unavailable (${res.status})`);
    const result = await res.json();
    await conn.setRemoteDescription({ type: "answer", sdp: result.transport.sdp });
  };

  /** One-shot fallback: listen once, ask the backend, speak the verdict. */
  const startWebSpeech = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!SR) {
      setMode("error");
      setError("Voice isn't supported in this browser — type instead.");
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setMode("webspeech");
    setAgentState("listening");
    rec.onresult = async (e: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const text = e.results[0][0].transcript as string;
      setAgentState("scanning");
      // No browser text-to-speech: only OpenAI's voice speaks. Without GPT-Live the answer is shown on screen.
      await onAsk(text).catch(() => undefined);
      setAgentState("idle");
    };
    rec.onerror = () => setAgentState("idle");
    rec.onend = () => setMode("off");
    rec.start();
  };

  const start = useCallback(async () => {
    setError("");
    setMode("connecting");
    try {
      await startLive();
    } catch (e) {
      cleanup();
      setError(`Voice unavailable (${(e as Error).message}). I'll listen once and show the answer on screen.`);
      startWebSpeech();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback(() => {
    if (dc.current?.readyState === "open") {
      send({ type: "session.close" }); // wait for session.closed to finalize
      window.setTimeout(() => { cleanup(); setMode("off"); setAgentState("idle"); }, 2000);
    } else {
      cleanup();
      setMode("off");
      setAgentState("idle");
    }
  }, [cleanup]); // eslint-disable-line react-hooks/exhaustive-deps

  return { mode, error, start, stop };
}
