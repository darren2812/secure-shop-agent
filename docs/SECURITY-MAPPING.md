# Security and standards mapping — Warden

Scope: this repo as of Nov 20 2026 (hackathon build: one seeded demo user, simulated checkout). Evidence is code in `backend/app/`, 111 pytest tests in `backend/tests/`, an adversarial review (Mythos, 18 findings, 6 fixes applied in commit `ac0bf6f`) and 6 Firedrill drill specs in `firedrill/`. OWASP item names below match the 2025 list from memory; the OWASP site didn't load the itemized list today, so treat the names as not re-verified. NIST AI RMF 1.0 was checked on nist.gov today; it is being revised.

## 1. OWASP Top 10 for LLM Applications (2025)

| Item | How Warden handles it (file) | Status |
|---|---|---|
| LLM01 Prompt injection | Seller text goes to Claude only inside spotlight tags with a random marker per request; `<`/`>` are stripped and words are datamarked (`agent.py` `spotlight`). Scores and tiers are set by code, so injected text can't change a verdict. Store names are cleaned to ≤40 plain characters (`tools.py` `safe_name`). | Implemented. Mitigates, doesn't eliminate: Claude's free-text `explanation` can still be steered. |
| LLM02 Sensitive info disclosure | Claude never receives identity, limits or decisions. The voice model gets only the verdict sentence that code builds. Keys stay on the server (`voice.py`). | Partial: `GET /api/audit/{id}` lets anyone read any receipt (no access control). |
| LLM03 Supply chain | Official Anthropic/OpenAI SDKs. Optional score providers can only add 2 allowed penalty codes and can't add hard gates (`extras.py`). | Partial: `requirements.txt` uses `>=` ranges, with no lockfile, hash pinning or SBOM. |
| LLM04 Data and model poisoning | No training or fine-tuning. Weights live in code, not the DB (`scoring.py`). Unknown signal codes are ignored. Reports and attacks are local/token-only (`main.py` `demo_only`). | Partial: one report blocks a store; no reputation threshold. |
| LLM05 Improper output handling | The model's output never runs as code or SQL. The spoken line comes from structured results (`agent.py` `build_say`). Tool args are length-capped and looked up by ID. React escapes all rendered text. | Implemented |
| LLM06 Excessive agency | Claude's only tools are search, scan and two UI tools. It has no purchase tool. `place_order` runs only from the Buy→Confirm route, needs a single-use decision with a 5-minute TTL, and re-checks store, price and an atomic monthly cap at pay time (`policy.py`). | Implemented. Gap: Claude can open the purchase sheet without the user asking (Mythos H13), though it still can't buy. |
| LLM07 System prompt leakage | Prompts hold no secrets or authorization logic, and they're public in the repo anyway. | Implemented (by design) |
| LLM08 Vector and embedding weaknesses | No RAG or vector store. | N/A |
| LLM09 Misinformation | The trust verdict is code-computed and each reason cites its source (`scoring.py` reasons + `source`). Voice instructions forbid "safe"/"verified" unless the backend says so. | Partial: the LLM explanation isn't checked against results. |
| LLM10 Unbounded consumption | `MAX_STEPS=8`, `max_tokens=1024`, 2000-character input cap. Voice: origin allowlist + demo token + 1 session per 15 s. | Partial: `/api/turn` and `/chat` have no auth or rate limit (Mythos H15); `MAX_SESSION_SECONDS` isn't enforced. |

## 2. CrowdStrike, "Five Steps for Frontier AI Security Readiness"

1. **Measure exploitability, not severity.** Mythos findings were ranked by how exploitable they are in this demo. The 6 that could actually be exploited (LAN-exposed admin routes and CSRF, cap bypass, blocked-store TOCTOU, brand-gate evasion, `\@` URL confusion, seller text in voice) were fixed before the freeze.
2. **Validate continuously, inside-out and outside-in.** 111 tests run in under 1 s. Outside-in: 6 Firedrill drills against `POST /chat` with rubric evaluations (fake Best Buy, prompt injection, no buy from text, fraud ring, legit-but-unusual store, unverified account). Inside-out: the attack scenarios in `/api/attacks`.
3. **Prevention, identity and containment with zero standing privileges.** The LLM holds no purchase capability. Each purchase needs a fresh, single-use, 5-minute decision plus a one-time Persona check. Identity comes from the server, never from the request body or the LLM.
4. **Detection and response as one pipeline.** Every step writes a hash-chained audit event (HMAC when `AUDIT_HMAC_KEY` is set), and `verify` reports the first altered or missing event. Fraud-ring SQL ties a new store to reported ones. Gap: no alerting.
5. **AI as an amplifier, not a replacement for judgment.** Claude explains and code decides. The human makes the final call with a tap.

## 3. NIST AI RMF 1.0

- **Govern:** written rules in the README "Security rules". Weights and gates are in code under version control.
- **Map:** `/api/trust` lists each service with the data sent and not sent. Mythos threat-modeled the full API surface (18 findings).
- **Measure:** 111 pytest tests (including a 12-way parallel order race test and cap tests), 6 Firedrill drills with rubric thresholds, and live prompt-injection probes in the Mythos review.
- **Manage:** 6 fixes applied (`ac0bf6f`). The rest is tracked in §5. Audit chain verification gives tamper evidence per decision.

## 4. Privacy and payments

- **Data per service** (from `/api/trust`):
  - Claude: product request, store signals and spotlighted seller text. No identity.
  - GPT-Live: user voice and the verdict sentence. No listings, policies or identity.
  - Persona: ID photo and selfie, sent directly to Persona. Today the front end uses a local stub; the real sandbox is a TODO in `VerifySheet.tsx`.
  - SingleStore: stores, listings, decisions, purchases, audit events.
  - Firedrill: test traffic only.
- **What we store about the user:** limits, a `verified` flag, `persona_inquiry_id`, decisions and purchases. The audit trail also stores request text, which includes voice transcripts. No ID images, no card data.
- **PCI DSS v4.0.1 (aligned, not certified):** Warden is designed for the lightest scope, SAQ A. Checkout is simulated today (`"simulated": true`), and no card number, CVV or expiry is ever collected, sent or stored. In production the card goes only to a tokenized processor (hosted fields or a wallet); Warden keeps only the processor token and last-4 for receipts. Requirements we still address without storing cards:
  - Req. 3 (protect stored account data): nothing to protect, because none is stored. The database has no card fields.
  - Req. 6 (secure software): spotlighting against prompt injection, input validation, 151 tests, Firedrill drills, exploitability-ranked fixes.
  - Req. 7 (least privilege): the LLM has no purchase tool, and spending limits change only by the human in the UI.
  - Req. 8 (identify users): one-time identity verification before any purchase.
  - Req. 10 (log and monitor): every decision goes into an HMAC-keyed, hash-chained audit trail (`audit.py`), verifiable via `/api/audit/{id}/verify`.
  - Gaps for real certification: a real processor integration, a hosted payment page, quarterly ASV scans, and an annual SAQ A attestation.
- **CCPA/GDPR:** the ID check is one-time, and only the inquiry ID is kept. Gaps: no privacy notice, retention period, deletion/export flow or DPAs. Append-only audit conflicts with erasure; fix by pseudonymizing request text or using crypto-shredding. Biometric data at Persona needs explicit consent (BIPA/GDPR Art. 9).

## 5. Production hardening

- Real per-user sessions (today `current_user()` is fixed), decisions bound to the session, access control on `/api/audit/{id}`.
- Rate limit and per-user budget on `/api/turn` and `/chat`. Ephemeral voice tokens instead of a shared demo token, and enforce the 10-minute cap.
- Persona: tie each inquiry to the user (`reference-id`), make it single-use, use signed webhooks, and allow the stub only behind an explicit flag.
- Anchor audit chain heads outside the DB to detect truncation; only allow `reset` in demo mode.
- Pinned, hashed dependencies, SBOM, dependency scanning. Disable `/docs` and `/openapi.json`.
- Full confusables detection (UTS #39) and a maintained brand list. Report reputation thresholds.
- Privacy notice, retention policy, deletion flow, DPAs with each vendor.

---

**Slide: Standards**
1. OWASP LLM Top 10 (2025): 4 implemented, 5 partial, 1 N/A, with every claim mapped to a file.
2. Excessive agency (LLM06): the LLM has no purchase tool. Buying takes a tap plus a single-use, 5-minute decision that's re-checked at pay time.
3. Prompt injection (LLM01): seller text is spotlighted with a random marker per request, and code sets every score.
4. CrowdStrike 5 steps: exploitability-ranked fixes (6 of 18), continuous tests (151) and Firedrill drills (6/6 passed, scores 85–99.5), no standing privileges for the AI.
5. NIST AI RMF: Govern (rules in code), Map (`/api/trust` data flows), Measure (tests + drills), Manage (hash-chained receipts).
6. PCI DSS: designed for SAQ A. Warden never sees or stores your card number; payments are tokenized by the processor. The audit log covers req. 10, and least privilege covers req. 7. One-time ID check, only the inquiry ID is stored.
