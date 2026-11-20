import type { AgentState, Tier } from "./store";

export const COLORS = {
  neutral: "#5B8CFF",
  trusted: "#22C55E",
  caution: "#F59E0B",
  blocked: "#EF4444",
  verify: "#8B5CF6",
  /** Agent state, not a verdict: shown only while the mic is open. */
  listening: "#22D3EE",
} as const;

/** Orb color: cyan while listening (a state, never a verdict), otherwise the API tier. */
export function orbHex(tier: Tier, agentState: AgentState): string {
  return agentState === "listening" ? COLORS.listening : tierHex(tier);
}

export function tierHex(tier: Tier): string {
  return tier ? COLORS[tier] : COLORS.neutral;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const TIER_LABEL: Record<Exclude<Tier, null>, { icon: string; text: string }> = {
  trusted: { icon: "✓", text: "Trusted" },
  caution: { icon: "!", text: "Caution" },
  blocked: { icon: "✕", text: "Blocked" },
  verify: { icon: "🔒", text: "Verify identity" },
};

export const STATE_LABEL: Record<AgentState, string> = {
  idle: "Tap the orb to talk",
  listening: "Listening…",
  scanning: "Checking the store…",
  speaking: "Speaking",
};
