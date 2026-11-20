# Secure Shopping Agent — Warden

Other agents ask you to trust a chat window. Warden is an orb you talk to: it turns green, amber or red from code the model can't touch, it can't spend a cent until you've proven it's you once and you tap to confirm, and every decision leaves a receipt you can verify.

Built at the Tokens& Personal Agents Hackathon (SF, Nov 20 2026).

**Proof:** 158 automated tests · Firedrill: 6/6 live attack scenarios passed (scores 85–99.5, threshold 75) · adversarial review: 18 findings, the 6 exploitable ones fixed before freeze.

## What you can do

- **Talk to the orb** (or type / paste a link): it searches every store and shows a results pop-up, Trusted / Caution / Blocked, with the reasons.
- **Store trust scores** (red flag button): every store with its 0–100 score; red flags first, with price vs typical price ("$119 · typical $249, 52% below"), fake discounts, brand impersonation and fraud-ring links.
- **Buy safely:** "I want to buy them" opens every option, "the Amazon one" highlights it, and only your tap pays. One-time ID + selfie with Persona.
- **Your limits:** per-purchase limit, monthly cap and marketplace on/off. Only you change them, in the app; the AI has no way to.
- **After buying:** "All good" or "Report this store". **Your purchases** lists past orders, and any of them can be reported. A report blocks the store and its linked family on the next search.
- **Receipts:** every step is a hash-chained receipt; Verify shows ✓, or ✕ with the first altered event.

## Sponsors and how we use them

| Sponsor | Role in Warden |
|---|---|
| **SingleStore** | Live store data, decisions, purchases and audit chain; the fraud-ring SQL (stores sharing an address, email, phone or policy text with a reported store). |
| **Cognee** | Store knowledge graph for two-hop links: NorthPeak shares a phone with AudioHub, which shares an address with reported GadgetFlash → NorthPeak drops from 100 to 70. Subtract-only: a Cognee failure can never raise a score. |
| **Persona** | One-time ID + selfie, just in time at the first purchase. Only the inquiry ID is stored. |
| **Firedrill** | Automated red team: simulated customers and scammers attack `POST /chat` on an isolated copy and score each conversation. |
| **Senso** | Optional, subtract-only policy signals (off in the live demo). |
| **Anthropic Claude** / **OpenAI GPT-Live** | Claude runs the tool loop and explains; GPT-Live is the voice. Neither decides a score or can buy. |

## How it works

- **Voice:** OpenAI GPT-Live 1.1 handles the conversation and delegates work to our backend (client delegation). The OpenAI key never leaves the server.
- **Brain:** Claude runs a tool loop (`search_listings`, `scan_store`). It has no purchase tool and never sees user identity.
- **Decisions:** plain code. `scan_store` turns store facts into signals, `score_store` applies hard gates and weights, `check_policy` enforces your limits, `place_order` runs only from a tap on Buy.
- **Graph:** optional providers (`extras.py`: Cognee, Senso) can only subtract points. Their results and sources show in each reason and in the receipt.
- **Receipts:** every step is an append-only, hash-chained audit event. `Verify trail` recomputes the chain and shows the first altered or missing event.

## Security rules

1. Code decides, the LLM explains. Weights live in code, not in the database.
2. Seller text (titles, policies) reaches Claude only as quoted, spotlighted data and never reaches the voice model. The only seller-chosen string in the spoken verdict is the store name, cleaned by code to a short plain name (no punctuation, max 40 characters).
3. Voice and text can't buy. Identity is verified once with Persona; after that, buying = tap → named confirm dialog (with a warning if over your usual limit).
4. Each purchase decision is single-use, expires after 5 minutes, and is re-checked at pay time (store tier, price, monthly cap applied atomically).
5. The voice-session endpoint checks origin, a demo token and a rate limit. Demo controls (reset, attacks, reports, verification) only answer this machine or the demo token, and refuse other sites' origins.
6. Brand impersonation is checked on a folded name (Unicode NFKC, look-alike letters and digits, punctuation removed). It errs on the safe side: a name like "Pineapple Audio" off apple.com is also blocked.
7. Spending limits change only through the UI (`PUT /api/me/limits`, demo-guarded, audited). They are not an LLM tool.
8. Card data is never collected or stored; checkout is designed for a tokenized processor (PCI DSS SAQ A model). Aligned with PCI DSS, not certified.

See [docs/SECURITY-MAPPING.md](docs/SECURITY-MAPPING.md) for the OWASP LLM Top 10 (2025), CrowdStrike, NIST AI RMF, PCI DSS v4.0.1 and privacy mapping.

## Run locally

```bash
cd backend
uv venv -p 3.12 .venv && VIRTUAL_ENV=.venv uv pip install -r requirements.txt
cp ../.env.example .env   # fill in your own keys; .env is gitignored
.venv/bin/uvicorn app.main:app --reload --port 8000
.venv/bin/python -m pytest -q tests
```

Without API keys the backend still works: search and scoring run in code and Persona uses a local stub.

For SingleStore, put `SINGLESTORE_HOST`, `SINGLESTORE_PORT`, `SINGLESTORE_USER`,
`SINGLESTORE_PASSWORD`, and optionally `SINGLESTORE_DATABASE` in the gitignored
root `.env.singlestore`. Use the **master (DDL) endpoint**: purchases use a rowstore
reference table, whose transactional writes require the master aggregator.

```bash
cd backend
.venv/bin/python scripts/setup_singlestore.py --configure
.venv/bin/python scripts/setup_singlestore.py --test
```

Setup creates and seeds `shop_demo` and `shop_drill`, preserves existing seeded
data, and `--configure` writes `DATABASE_URL` for `shop_demo` into `backend/.env`.
The test command resets only `shop_drill`. You can also pass a percent-encoded
`mysql://user:password@host:3306/shop_drill` URL as `TEST_DATABASE_URL` to pytest.
Ordinary pytest runs use SQLite even when `backend/.env` points at `shop_demo`.
To run the app on SQLite, set `DATABASE_URL` to an empty value.

On the SingleStore free shared tier (max 10 tables, no reference tables) set
`SINGLESTORE_SHARED_TIER=1`.

Cognee (optional): install `requirements-cognee.txt` in a separate venv, set
`COGNEE_ENABLED=1`, `SYSTEM_ROOT_DIRECTORY` and `DATA_ROOT_DIRECTORY` (absolute
paths), run `scripts/seed_cognee.py`, then start uvicorn from that venv.
`/api/health` shows `"cognee": "live"` and the log prints the two-hop links (store names only).

Web: `cd web && npm install && npm run dev` (Vite on :5173, proxies `/api` to :8000).

**Demo autopilot:** Shift+D arms it, → / Space / a presentation clicker runs the next of 6 steps, Esc exits. It drives the real app (real API calls, real Claude answers, real scores) and only automates clicks and typing.

## API

See `contracts/` for example requests and responses.

| Endpoint | Purpose |
|---|---|
| `POST /api/turn` | text, pasted link or voice transcript → results, tier, spoken verdict |
| `POST /chat` · `GET /health` | Firedrill-shaped chat endpoint and health check |
| `POST /api/policy/check` | re-check a listing at pick time → allow / verify / deny + decision_id |
| `POST /api/orders` | simulated checkout for a decision (Buy button only) |
| `GET /api/audit/{id}` / `POST /api/audit/{id}/verify` | receipt timeline / verify hash chain |
| `GET /api/me` · `PUT /api/me/limits` | profile and spent this month / set limits (UI only, audited) |
| `GET /api/red-flags` | every store with its code-computed score and reasons (read-only) |
| `GET /api/purchases` | past orders, with whether each store is reported |
| `POST /api/reports` | report a store (blocks it and its linked family) |
| `GET /api/trust` | what data goes where, and which protections are active |
| `POST /api/reset_demo` | reseed demo data |
| `POST /api/voice/session` | create a GPT-Live WebRTC session |

## What's real and what's simulated

- Real: scoring, policy checks, hash-chained audit, fraud-ring SQL, GPT-Live voice, Claude tool calling, Persona sandbox (when configured).
- Simulated: checkout (no money moves), seeded store data (domain ages stand in for RDAP) and the four seeded past purchases.

## Known limits and next steps

- One report blocks a store. Production would use weighted reports: verified buyers only, a threshold, and human review before a hard block.
- Single demo user. Production needs real per-user sessions, per-user rate limits and ephemeral voice tokens.
- Voice needs https or localhost (browser microphone rule); other devices on the LAN can type.
- Firedrill drills ran before Cognee, limits and purchases were added; the scoring and blocking logic they attack is unchanged.

## Prior art

Patterns (state-scoped tools, orb state design) come from team members' earlier projects. No code was copied; all code in this repo was written during the event.
