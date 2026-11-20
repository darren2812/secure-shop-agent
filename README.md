# Secure Shopping Agent — Warden

Other agents ask you to trust a chat window. Warden is an orb you talk to: it turns green, amber or red from code the model can't touch, it can't spend a cent until you've proven it's you once and you tap to confirm, and every decision leaves a receipt you can verify.

Built at the Tokens& Personal Agents Hackathon (SF, Nov 20 2026).

## How it works

- **Voice:** OpenAI GPT-Live 1.1 handles the conversation and delegates work to our backend (client delegation). The OpenAI key never leaves the server.
- **Brain:** Claude runs a tool loop (`search_listings`, `scan_store`). It has no purchase tool and never sees user identity.
- **Decisions:** plain code. `scan_store` turns store facts into signals, `score_store` applies hard gates and weights, `check_policy` enforces your limits, `place_order` runs only from a tap on Buy.
- **Receipts:** every step is an append-only, hash-chained audit event. `Verify trail` recomputes the chain and shows the first altered or missing event.

## Security rules

1. Code decides, the LLM explains. Weights live in code, not in the database.
2. Seller text (titles, policies) reaches Claude only as quoted, spotlighted data and never reaches the voice model. The only seller-chosen string in the spoken verdict is the store name, cleaned by code to a short plain name (no punctuation, max 40 characters).
3. Voice and text can't buy. Identity is verified once with Persona; after that, buying = tap → named confirm dialog (with a warning if over your usual limit).
4. Each purchase decision is single-use, expires after 5 minutes, and is re-checked at pay time (store tier, price, monthly cap applied atomically).
5. The voice-session endpoint checks origin, a demo token and a rate limit. Demo controls (reset, attacks, reports, verification) only answer this machine or the demo token, and refuse other sites' origins.
6. Brand impersonation is checked on a folded name (Unicode NFKC, look-alike letters and digits, punctuation removed). It errs on the safe side: a name like "Pineapple Audio" off apple.com is also blocked.

See [docs/SECURITY-MAPPING.md](docs/SECURITY-MAPPING.md) for the OWASP LLM Top 10, CrowdStrike, NIST AI RMF and privacy/PCI mapping.

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

## API

See `contracts/` for example requests and responses.

| Endpoint | Purpose |
|---|---|
| `POST /api/turn` | text, pasted link or voice transcript → results, tier, spoken verdict |
| `POST /api/policy/check` | re-check a listing at pick time → allow / verify / deny + decision_id |
| `POST /api/orders` | simulated checkout for a decision (Buy button only) |
| `GET /api/audit/{id}` / `POST /api/audit/{id}/verify` | receipt timeline / verify hash chain |
| `POST /api/reports` | report a store |
| `POST /api/reset_demo` | reseed demo data |
| `POST /api/voice/session` | create a GPT-Live WebRTC session |

## What's real and what's simulated

- Real: scoring, policy checks, hash-chained audit, fraud-ring SQL, GPT-Live voice, Claude tool calling, Persona sandbox (when configured).
- Simulated: checkout (no money moves) and seeded store data (domain ages stand in for RDAP).

## Prior art

Patterns (state-scoped tools, orb state design) come from team members' earlier projects. No code was copied; all code in this repo was written during the event.
