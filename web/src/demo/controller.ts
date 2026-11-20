import { create } from "zustand";
import { useOrbStore } from "../orb/store";

/**
 * Demo autopilot controller. It only automates clicks and typing on the real UI: every API call,
 * Claude answer and score still comes from the running backend. Nothing here decides anything.
 * Keys: Shift+D arms, → / Space / PageDown runs the next step, Esc stops. `?autopilot=1` shows the dot.
 */
export const STEP_COUNT = 6;
const STEP_TIMEOUT_MS = 30_000;

export type RunState = "idle" | "running" | "done" | "error";
interface AutopilotStore {
  armed: boolean;
  /** Steps completed so far (0..STEP_COUNT). The badge shows the one that runs next. */
  done: number;
  run: RunState;
  error: string;
  /** Mounted Home stays alive (hidden) while #/attack is shown, so the conversation survives. */
  keepHome: boolean;
}
export const useAutopilot = create<AutopilotStore>(() => ({ armed: false, done: 0, run: "idle", error: "", keepHome: false }));
const set = useAutopilot.setState;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pause = () => sleep(600 + Math.random() * 300);
const q = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);

async function waitFor<T>(what: string, fn: () => T | null | undefined | false, timeout = STEP_TIMEOUT_MS): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await sleep(100);
  }
}
const byText = (sel: string, re: RegExp) => [...document.querySelectorAll<HTMLElement>(sel)].find((e) => re.test(e.textContent ?? ""));
const click = (el: HTMLElement) => el.click();

/** Type into the real, React-controlled #ask input one char at a time, then press the real Check button. */
async function typeAndSubmit(value: string) {
  const input = await waitFor("ask input", () => q<HTMLInputElement>("#ask"));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  const put = (v: string) => { setter.call(input, v); input.dispatchEvent(new Event("input", { bubbles: true })); };
  put("");
  for (let i = 1; i <= value.length; i++) { put(value.slice(0, i)); await sleep(25); }
  await sleep(400);
  const btn = await waitFor("Check button", () => { const b = q<HTMLButtonElement>(".home__check"); return b && !b.disabled ? b : null; });
  const orb = useOrbStore;
  btn.click();
  // ask() sets "scanning" synchronously and goes back to idle/listening once the API answered.
  await waitFor("turn to start", () => orb.getState().agentState === "scanning", 3000).catch(() => undefined);
  await waitFor("answer from the agent", () => orb.getState().agentState !== "scanning");
  const err = q(".home__err");
  if (err?.textContent) throw new Error(err.textContent);
}

async function closeOpenDialogs() {
  for (let i = 0; i < 4; i++) {
    const open = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].pop();
    if (!open) return;
    const btn = open.querySelector<HTMLElement>(".psheet__x, .psheet__cancel, .buy__primary, .buy__actions button");
    if (btn) btn.click(); else open.dispatchEvent(new Event("cancel", { cancelable: true }));
    await sleep(500);
  }
}

async function goHome() {
  if (window.location.hash.replace(/^#/, "").startsWith("/attack")) {
    window.location.hash = "#/";
    await waitFor("home", () => q("#ask"));
  }
}

const steps: Array<() => Promise<void>> = [
  // 1. Reset, then search by "voice" (orb listening look) + typed query.
  async () => {
    await goHome();
    await closeOpenDialogs();
    click(await waitFor("reset button", () => byText(".home__foot button", /reset demo/)));
    await waitFor("reset to finish", () => byText(".home__foot button", /^reset demo$/) && useOrbStore.getState().label.startsWith("Demo reset"), 20_000);
    await pause();
    useOrbStore.getState().setAgentState("listening");
    useOrbStore.getState().setLabel("Listening…");
    await sleep(1400);
    await typeAndSubmit("Find me AirPods Pro under 260 dollars");
    await waitFor("results pop-up", () => q("dialog.rpop[open]"));
    await sleep(1500);
  },
  // 2. Trust scores sheet, scroll to NorthPeak, close.
  async () => {
    await closeOpenDialogs();
    await pause();
    click(await waitFor("red flags button", () => q(".flagsbtn")));
    const body = await waitFor("score list", () => q(".rfsheet__body") && document.querySelector(".rfcard") && q(".rfsheet__body"));
    const card = await waitFor("NorthPeak card", () => byText(".rfcard", /NorthPeak/i));
    await pause();
    const top = card.offsetTop - body.offsetTop - 12;
    body.scrollTo({ top, behavior: "smooth" });
    await sleep(2500);
    click(await waitFor("close sheet", () => q(".rfsheet .psheet__go")));
    await sleep(700);
  },
  // 3. Attack page: the same handler as "Hide an instruction to the AI", then back to Home.
  async () => {
    await closeOpenDialogs();
    set({ keepHome: true });
    window.location.hash = "#/attack";
    const btn = await waitFor("attack button", () => byText(".attack__grid button", /Hide an instruction/));
    await pause();
    click(btn);
    await waitFor("attack result", () => q(".attack__result .attack__same") || q(".attack__result"), STEP_TIMEOUT_MS);
    await sleep(3500);
    window.location.hash = "#/";
    await waitFor("home", () => q("#ask") && !q(".attack"));
    set({ keepHome: false });
    await sleep(600);
  },
  // 4. Buy: agent tool call opens the sheet, focus the Amazon listing, Continue, Persona stub, confirm.
  async () => {
    await closeOpenDialogs();
    await pause();
    await typeAndSubmit("I want to buy them");
    await waitFor("purchase sheet", () => q("dialog.psheet[open]:not(.rfsheet)"));
    await sleep(1200);
    await closeOpenDialogs(); // close it so the next typed line is visible; the agent reopens it
    await typeAndSubmit("The Amazon one");
    await waitFor("Amazon focused", () => q("dialog.psheet[open] .popt--focus"));
    await sleep(1500);
    click(await waitFor("Continue", () => { const b = q<HTMLButtonElement>("dialog.psheet[open] .psheet__go"); return b && !b.disabled ? b : null; }));
    // Persona stub step appears only the first time (server decides); same button the UI shows.
    const next = await waitFor("verify or confirm", () => q(".vsheet__go") || byText(".buy__primary", /Yes, buy it/) || q(".buy--denied"));
    if (next.classList.contains("vsheet__go")) {
      await pause();
      click(next);
      await waitFor("confirm after Persona", () => byText(".buy__primary", /Yes, buy it/));
    }
    await pause();
    click(await waitFor("Yes, buy it", () => byText(".buy__primary", /Yes, buy it/)));
    await waitFor("order placed", () => byText("dialog.buy h2", /Done — order placed/));
    await sleep(1200);
    click(await waitFor("All good", () => byText(".buy__feedback-btns button", /All good/)));
    await sleep(1200);
  },
  // 5. Receipt: close the buy dialog, show the audit panel, press Verify. (No tamper control exists.)
  async () => {
    await closeOpenDialogs();
    await pause();
    if (!q(".audit")) click(await waitFor("View receipt", () => byText(".home__receipt", /View receipt/)));
    const audit = await waitFor("audit panel", () => q(".audit"));
    await waitFor("audit rows", () => q(".audit__list li"));
    audit.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(1500);
    click(await waitFor("Verify", () => { const b = q<HTMLButtonElement>(".audit__verify"); return b && !b.disabled ? b : null; }));
    const res = await waitFor("verify result", () => q(".audit__ok, .audit__bad"));
    res.scrollIntoView({ behavior: "smooth", block: "end" });
    await sleep(2000);
  },
  // 6. Leave a clean, normal state.
  async () => {
    await closeOpenDialogs();
    await goHome();
    set({ keepHome: false });
    const ns = byText(".home__new", /New search/);
    if (ns) click(ns);
    window.scrollTo({ top: 0, behavior: "smooth" });
    useOrbStore.getState().setTier(null);
    useOrbStore.getState().setAgentState("idle");
    await sleep(600);
  },
];

export async function runNext() {
  const s = useAutopilot.getState();
  if (!s.armed || s.run === "running") return;
  if (s.done >= STEP_COUNT) return disarm();
  const i = s.done; // retry the same step after an error
  set({ run: "running", error: "" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      steps[i](),
      new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("step timed out")), STEP_TIMEOUT_MS * 3); }),
    ]);
    if (useAutopilot.getState().armed) set({ done: i + 1, run: i + 1 >= STEP_COUNT ? "done" : "idle" });
  } catch (e) {
    if (useAutopilot.getState().armed) set({ run: "error", error: (e as Error).message });
  } finally {
    clearTimeout(timer);
  }
}

export function arm() { set({ armed: true, done: 0, run: "idle", error: "" }); }
export function disarm() { set({ armed: false, run: "idle", error: "", keepHome: false }); }
