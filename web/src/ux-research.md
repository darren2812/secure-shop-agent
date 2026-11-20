# UX research — an agent a child and a grandparent can use

Scope: voice/chat shopping agent that can spend money. Time-boxed (≤10 min); web search was down,
so sources were fetched directly. Sources marked † could not be fetched live (bot wall) and are cited
from established guidance.

## Findings

- **Older adults** (NN/g, 123 participants 65+, 3 rounds): the top failures are small type, low
  contrast, tiny targets, and unforgiving interfaces. They make more mistakes and blame themselves;
  error messages get overlooked or are worded vaguely. Accept many input forms (type *or* say it).
- **Children** (NN/g, 125 kids aged 3–12): kids follow UI conventions, tap/swipe fine, scroll only when
  cues show more content, can't troubleshoot or read error messages. Plain text at grade 8–10 works for broad
  audiences. Put parent/admin links in a quiet text-only footer kids skip.
- **Agentic AI** (Smashing, 2026): lifecycle patterns — *Intent Preview* before acting (plain words,
  "Buy AirPods from X for $189", never API jargon), *Explainable Rationale* + confidence while working,
  *Action Audit & Undo* + escalation after. The preview is a decision point: deliberate friction only for
  irreversible or high-stakes steps.
- **Human-AI interaction** (Microsoft HAX, 18 guidelines): make clear what the system can do, show
  contextually relevant info, support efficient dismissal and correction, explain why it did something.
- **Accessibility** (WCAG 2.2 SC 2.5.8 †, Apple HIG †, W3C WAI older users †): targets ≥24px min, 44–48px
  recommended; respect reduced motion; don't use color alone; no time limits; keep focus inside modals and
  return it to the opener when they close.
- **Just-in-time KYC** (Persona progressive KYC †, fintech practice): ask for identity *at the moment of
  need*, not at signup; say why in user terms; one step, say how long it takes and that it's once; let people
  back out without losing their place.

## Rules applied (numbered)

1. One primary action per screen. Home: the orb + "Tap to talk". Results: one big "Buy".
2. Two ways to say it: voice or one text field (product name *or* link) → one "Check" button.
3. Recognition over recall: suggestion chips on first use ("AirPods Pro", "Paste a link").
4. Plain-language state, always as text: "Listening…", "Checking stores…", then the agent's answer.
5. Best pick first, other options collapsed ("See N other options"); "score" stays secondary.
6. Intent preview before money moves: "Buy AirPods Pro from X for $189?" with Confirm / Cancel
   equal size, and no countdowns.
7. Identity just-in-time: Persona opens as a pop-up only when the server asks (`outcome: "verify"`), says
   why ("So nobody else can shop with your card"), what happens (ID + selfie, ~1 min, once), with one big
   button and a quiet "Not now" that cancels with no charge.
8. One decision per modal screen; clear outcome screen ("Done — order placed") with an obvious close.
9. Forgiving: Esc / Cancel / "Not now" always exit without side effects; errors say whether you were charged.
10. Text ≥17px, targets ≥48px, AA contrast, tier = icon + word + color, focus moves into and back out of
    modals, `prefers-reduced-motion` disables animation.
11. Demo/admin links (attack, orb-lab, reset) live in a quiet footer.

## Sources

- https://www.nngroup.com/articles/usability-for-senior-citizens/
- https://www.nngroup.com/articles/childrens-websites-usability-issues/
- https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/
- https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/
- † https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- † https://www.w3.org/WAI/older-users/developing/
- † https://developer.apple.com/design/human-interface-guidelines/accessibility
- † https://withpersona.com/blog/what-is-progressive-kyc
