// Typed client for the backend contract (see /contracts). Identity is server-side; never send user ids.
import type { Tier } from "./orb/store";

export type ResultTier = Exclude<Tier, null | "verify">;

export interface Reason {
  code: string;
  text: string;
  weight: number | null;
  source: string;
}

export interface Result {
  listing_id: string;
  store: { id: string; name: string; domain: string };
  price: number;
  title: string;
  score: number;
  tier: ResultTier;
  reasons: Reason[];
  linked_stores: { id: string; name: string; attribute: string }[];
}

export interface TurnResponse {
  request_id: string;
  say: string;
  explanation: string;
  tier: ResultTier | null;
  results: Result[];
  /** Agent tool call for the UI. The agent never buys; it can only open or point at options. */
  ui_action?: { type: "show_options" } | { type: "focus_listing"; listing_id: string } | null;
}

export interface Decision {
  decision_id: string;
  outcome: "allow" | "verify" | "deny";
  reasons: string[];
  warnings: string[];
  listing_id: string;
  store: { id: string; name: string; domain: string };
  tier: ResultTier;
  score: number;
  score_reasons: string[];
  amount: number;
}

export interface Order {
  purchase_id: string;
  decision_id: string;
  amount: number;
  status: string;
  simulated: boolean;
}

export interface AuditEvent {
  request_id: string;
  seq: number;
  ts: string;
  step: string;
  actor: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface VerifyResult {
  intact: boolean;
  events: number;
  broken_seq?: number;
  reason?: string;
}

export interface Profile {
  verified: boolean;
  per_purchase_limit: number;
  monthly_cap: number;
  allow_marketplace: boolean;
  spent_this_month: number;
}

export interface RedFlagStore {
  store_id: string;
  name: string;
  domain: string;
  tier: "blocked" | "caution" | "trusted";
  score: number;
  price: number | null;
  typical_price?: number;
  pct_below?: number;
  reasons: { code: string; text: string }[];
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public charged = false) {
    super(message);
  }
}

const DEMO_TOKEN = import.meta.env.VITE_DEMO_TOKEN as string | undefined;

/** Demo controls (reset, attacks, verification) need this when the app isn't opened on the same machine. */
export const demoHeaders = (): Record<string, string> => (DEMO_TOKEN ? { "X-Demo-Token": DEMO_TOKEN } : {});

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...demoHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = (data as { detail?: unknown }).detail;
    if (d && typeof d === "object") {
      const e = d as { code?: string; message?: string; charged?: boolean };
      throw new ApiError(e.code ?? "error", e.message ?? "Request failed", e.charged ?? false);
    }
    throw new ApiError("error", typeof d === "string" ? d : `Request failed (${res.status})`);
  }
  return data as T;
}

export type Purchase = {
  id: string; store_id: string; store_name: string; domain: string | null; title: string;
  amount: number; date: string; status: string; reported: boolean;
};

export const api = {
  turn: (text: string, request_id?: string) => call<TurnResponse>("POST", "/api/turn", { text, request_id }),
  checkPolicy: (listing_id: string, request_id: string) =>
    call<Decision>("POST", "/api/policy/check", { listing_id, request_id }),
  order: (decision_id: string, verification_id?: string) =>
    call<Order>("POST", "/api/orders", { decision_id, verification_id }),
  personaStubPass: (inquiry_id: string) => call<unknown>("POST", `/api/persona/stub-pass/${inquiry_id}`),
  audit: (request_id: string) => call<{ events: AuditEvent[] }>("GET", `/api/audit/${request_id}`),
  verify: (request_id: string) => call<VerifyResult>("POST", `/api/audit/${request_id}/verify`),
  me: () => call<Profile>("GET", "/api/me"),
  setLimits: (l: { per_purchase_limit: number; monthly_cap: number; allow_marketplace: boolean }) =>
    call<Profile>("PUT", "/api/me/limits", l),
  verifyMe: (inquiry_id: string) => call<{ verified: boolean }>("POST", "/api/me/verify", { inquiry_id }),
  redFlags: () => call<{ stores: RedFlagStore[] }>("GET", "/api/red-flags"),
  purchases: () => call<{ purchases: Purchase[] }>("GET", "/api/purchases"),
  reset: () => call<unknown>("POST", "/api/reset_demo"),
  report: (storeId: string, requestId?: string) =>
    call<{ store_id: string; flagged: boolean }>("POST", "/api/reports", { store_id: storeId, request_id: requestId }),
};
