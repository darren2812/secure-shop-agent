import { create } from "zustand";

export type AgentState = "idle" | "listening" | "scanning" | "speaking";
export type Tier = null | "trusted" | "caution" | "blocked" | "verify";

export const AGENT_STATES: AgentState[] = ["idle", "listening", "scanning", "speaking"];
export const TIERS: Tier[] = [null, "trusted", "caution", "blocked", "verify"];

export interface OrbStore {
  agentState: AgentState;
  /**
   * Verdict tier. Must ONLY be set through `setTier(fromApi)` with the `tier`
   * field returned by the backend scoring API. Never derive it on the client
   * (from model text, voice output, URL heuristics, etc.) — the orb color is a
   * security signal and the server is its single source of truth.
   * /orb-lab is the one exception: it forces tiers for design/test only.
   */
  tier: Tier;
  /** 0..1 smoothed audio RMS (mic while listening, remote track while speaking). */
  level: number;
  /** Optional free text override for the label under the orb. */
  label: string;
  /** Forced reduced-motion (orb-lab toggle); OR'ed with the OS preference. */
  forceReducedMotion: boolean;

  setAgentState: (s: AgentState) => void;
  /** Pass the `tier` value straight from the API response. See `tier` docs. */
  setTier: (fromApi: Tier) => void;
  setLevel: (level: number) => void;
  setLabel: (label: string) => void;
  setForceReducedMotion: (v: boolean) => void;
}

export const useOrbStore = create<OrbStore>((set) => ({
  agentState: "idle",
  tier: null,
  level: 0,
  label: "",
  forceReducedMotion: false,
  setAgentState: (agentState) => set({ agentState }),
  setTier: (fromApi) => set({ tier: fromApi ?? null }),
  setLevel: (level) => set({ level: Math.max(0, Math.min(1, level)) }),
  setLabel: (label) => set({ label }),
  setForceReducedMotion: (forceReducedMotion) => set({ forceReducedMotion }),
}));
