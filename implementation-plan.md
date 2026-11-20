# Implementation Plan (from Plan v2)

**Source of truth:** `secure-shopping-agent-plan.md` (v2). This file breaks it into steps. **Each step is one session** (one person or one Claude Code session, one branch, one merge).
**Written:** 13:05. Freeze 3:30. Hacking ends 4:30.
**Decisions (13:05):** SingleStore stays: S0 is the owner's own step, already in progress. Firedrill drills run on **SingleStore `shop_drill`**. Senso key works. Cognee is planned, and it's the first thing to cut.

---

## Order and parallel lanes

```
13:05 ─ S0 SingleStore (owner) ──────────────┐
13:05 ─ S1 /chat alias (N1) ─┐               │
13:10 ─ S2 Extras foundation ┼───────────────┼─ S3 Senso ──────────┐
                             │               └─ S4 Cognee ─────────┤
                             └─ S5 Firedrill harness (needs S0 for shop_drill) ─┤
                                                         S6 Claims + README + voice ─┤
                                                                     S7 Freeze QA (3:20)
```

| Step | Session | Owner | Window | Depends on |
|---|---|---|---|---|
| S0 | SingleStore connection | You | now → 1:45 | — |
| S1 | `/chat` alias, `/health`, `PORT` entry point | N1 | 1:05 → 1:20 | — |
| S2 | Extras foundation (scoring codes, provider hook, `sources`) | Backend | 1:10 → 1:45 | — (works on SQLite) |
| S3 | Senso signal | Backend | 1:45 → 2:45 | S2; S0 for the `senso_docs` table on SingleStore |
| S4 | Cognee signal + NorthPeak seed | Backend 2 / Claude session | 1:45 → 3:00 (go/no-go 2:00) | S2 |
| S5 | Firedrill harness + reset hook + scenarios | Tester | 1:20 → 2:30 (dry run 2:30) | S1; S0 for `shop_drill` |
| S6 | Claims, README, Trust panel, voice delegation | Frontend | 2:45 → 3:20 | S0, S3, S4 outcomes |
| S7 | Freeze QA + final Firedrill campaign | Tester + all | 3:20 → 3:50 | everything merged |

S1, S2 and S0 can run at the same time. S3 and S4 can run at the same time after S2 merges.

---

## Rules for every session

1. Start from the latest `main`. Work on `step/sN-<name>`. Merge as soon as "Done when" passes. Small merges beat one big one at 3:20.
2. Read only the plan sections the step names. Don't redesign. If the plan is wrong, write a one-line note under "Plan corrections" at the end of this file and continue.
3. **The existing 60 tests stay green on SQLite:** `cd backend && .venv/bin/python -m pytest -q tests`.
4. **Never point tests or reset scripts at `shop_demo`.** Tests run on SQLite by default, or on a database whose name ends in `_drill` or `_test` (S0 adds the guard).
5. Senso and Cognee are **off** in tests and drills. Tests use fakes, never the network.
6. Seller text never goes into reason text, `say`, `reply` or audit payloads beyond what's there today.
7. Stay inside your step's files (table below). If you must touch another step's file, keep the change to a few lines and say so in the merge message.

### File ownership

| File | S0 | S1 | S2 | S3 | S4 | S5 | S6 |
|---|---|---|---|---|---|---|---|
| `backend/app/db.py` | **own** | | | | | | |
| `backend/schema.sql` | **own** | | | +`senso_docs` | | | |
| `backend/tests/conftest.py` (new) | **own** | | | | | | |
| `backend/app/chat.py` (new), `app/__main__.py` (new) | | **own** | | | | | |
| `backend/app/main.py` | lines | +2 routes | lifespan, reset, health | | | | `/api/trust` text |
| `backend/app/scoring.py` | | | **own** | | | | |
| `backend/app/extras.py` (new) | | | **own** | register | register | | |
| `backend/app/tools.py`, `policy.py`, `agent.py` | `INSERT IGNORE` | | **own** | | | | |
| `backend/app/senso.py`, `scripts/seed_senso.py`, `seed/senso/*` (new) | | | | **own** | | | |
| `backend/app/graph.py`, `scripts/seed_cognee.py`, `requirements-cognee.txt` (new) | | | | | **own** | | |
| `backend/app/seed.py` | | | | | NorthPeak | | |
| `backend/scripts/reset_drill_state.py`, `firedrill/` (new) | | | | | | **own** | |
| `README.md`, `.env.example`, `backend/app/voice.py`, `contracts/` | | | | | | | **own** |

### Environment variables (all steps)

| Var | Set by step | Value |
|---|---|---|
| `DATABASE_URL` | S0 | `mysql://user:pass@host:3306/shop_demo` (demo) or `.../shop_drill` (drills). Empty = SQLite |
| `TEST_DATABASE_URL` | S0 | optional; must end in `_drill` or `_test` |
| `SENSO_API_KEY`, `SENSO_MIN_SCORE=0.35`, `SENSO_TIMEOUT_S=4`, `SENSO_CACHE_TTL_S=900`, `SENSO_SCOPE_FIELD` | S3 | `SENSO_SCOPE_FIELD` = REST field name from spike S1, or empty for the filter fallback |
| `COGNEE_ENABLED=1`, `SYSTEM_ROOT_DIRECTORY`, `DATA_ROOT_DIRECTORY` (absolute), `TELEMETRY_DISABLED=true` | S4 | |

---

## S0. SingleStore connection (you)

**Goal:** `DATABASE_URL` set → the whole app runs on SingleStore; empty → SQLite as today.
**Plan:** §7.
**Status:** complete and verified on 2026-11-20.

**Tasks**
1. `db.py`: when `DATABASE_URL` is set, `connect()` yields a small wrapper over a MySQL-protocol client with the same surface the code uses: `conn.execute(sql, params)` returning a cursor with `fetchone()`, `fetchall()`, `rowcount`, `description`; commit on success, rollback on exception, close in `finally`.
   - Translate `?` → `%s` in the wrapper. (There are no literal `?` characters in our SQL strings today.)
   - Connect with **`FOUND_ROWS`** (pymysql: `client_flag=pymysql.constants.CLIENT.FOUND_ROWS`). Otherwise `UPDATE stores SET flagged = 1` on an already-flagged store returns `rowcount` 0 and `/api/reports` answers 404.
   - Autocommit off (each `connect()` block is one transaction, like SQLite today).
2. `init_db()`: SQLite keeps `executescript`; SingleStore runs one `execute` per statement (split `schema.sql` on `;`).
3. `policy.py:148`: `INSERT OR IGNORE` → dialect switch (`INSERT IGNORE` on SingleStore). Add a tiny `db.insert_ignore()` helper or a `db.DIALECT` constant.
4. `schema.sql`: `purchases` needs **`SHARD KEY (decision_id)`** (or make it a rowstore reference table), because on sharded tables every UNIQUE key must contain the shard key. Keep the file working on SQLite: either a separate `schema.singlestore.sql`, or strip the SingleStore-only clause when running on SQLite. Your choice; note it here.
5. **`backend/tests/conftest.py` (new, important):** before any app import, set `os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "")`, and refuse to run if that database name doesn't end in `_drill` or `_test`. Also set `SENSO_API_KEY=""` and `COGNEE_ENABLED=""`. **Why:** `test_api.py` imports `app.main`, which loads `backend/.env`. If `.env` holds `DATABASE_URL=.../shop_demo`, every test's `reset_demo` would wipe the demo database.
6. Create both databases (`shop_demo`, `shop_drill`), run `init_db()` + `reset_and_seed()` on each.
7. Add the driver to `requirements.txt`.

**Implementation choices:** shared `schema.sql` uses `ROWSTORE REFERENCE` for
`purchases`; SQLite initialization strips that modifier. Both purchase unique
keys remain enforced. SingleStore uses the master/DDL endpoint for transactional
reference-table writes. `scripts/setup_singlestore.py --configure` provisions the
databases and writes the local demo URL; `--test` runs the suite on `shop_drill`.

**Validation:** 73 tests pass on SQLite and 73 on SingleStore `shop_drill`.
`shop_demo` smoke checks passed
(six seeded tiers, purchase placed once/replay refused, repeat report 200, audit
trail intact with 11 events); demo data restored afterward. Explicitly pointing
pytest at `shop_demo` is refused before collection. Local `backend/.env` selects
`shop_demo`; credentials remain in gitignored files.

**Done when**
- `pytest -q tests` green on SQLite (no `TEST_DATABASE_URL`).
- `TEST_DATABASE_URL=.../shop_drill pytest -q tests` green on SingleStore.
- Backend on `shop_demo`: a text search returns the §3.2 tiers; a purchase places once; reporting an already-flagged store returns 200; `Verify trail` is intact.
- Fallback rule from the plan: if this isn't green by **2:45**, keep SQLite and S6 changes the claims.

**Out of scope:** schema redesign, integer cents, moving off `DECIMAL`.

---

## S1. `/chat` alias, `/health`, `PORT` entry point (N1, ~15 min)

**Goal:** Firedrill can talk to the agent and read a code-built `reply` with a `Status:` line.
**Plan:** §4.
**Status:** implemented and verified locally on 2026-11-20, on `step/s1-chat`.

**Validation:** 91 tests pass on SQLite. `PORT=8123 .venv/bin/python -m app`
answers `/health` with `{"ok": true}`; `/chat` returns six offers for AirPods Pro
and its reply ends with `Status: RESULTS_READY`. Process smoke checks used a
temporary SQLite database with external providers disabled.

**Tasks**
1. `backend/app/chat.py`: `chat_status(out) -> str` and `chat_reply(out) -> str` exactly as in §4 (statuses `NO_RESULTS`, `BLOCKED_STORE`, `TAP_TO_CONFIRM`, `RESULTS_READY`; reply = explanation, "Results (scored by code):" lines with name, price, tier, score if not Blocked, first reason text; then `say`; then `Status: X`). **No listing titles.**
2. `main.py`: `ChatIn {message, session}` → `run_turn(message, session)`; add `status`, `reply`, `session`. Add `GET /health` → `{"ok": true}`. If `session` fails `RID`, hash it to `fd_<sha256[:16]>` instead of returning 422.
3. `backend/app/__main__.py`: `uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8000")))`, no reload.
4. Tests T1–T3 (§9.2) in `tests/test_chat.py`.

**Done when:** T1–T3 + existing tests green; `PORT=8123 .venv/bin/python -m app` answers `curl -s localhost:8123/health`; `curl -s -XPOST localhost:8123/chat -d '{"message":"AirPods Pro","session":"drill-1"}' -H 'content-type: application/json' | jq -r .reply` ends in `Status: RESULTS_READY`.

**Out of scope:** changing `/api/turn`, the web app, or the agent.

---

## S2. Extras foundation (backend)

**Goal:** one place where optional sources plug into `scan_store`, so S3 and S4 only add a module and one registration line, and can run in parallel.
**Plan:** §2 rule 5, §3.1, §5 and §6 ("At scan time" parts).

**Tasks**
1. `scoring.py`: add penalties `policy_red_flag: (-10, 'Return policy says "{phrase}"')` and `linked_two_hops: (-30, "Linked to reported store {other} through {via}")`.
2. `backend/app/extras.py` (new):
   ```python
   EXTRA_CODES = {"policy_red_flag", "linked_two_hops"}   # extras may emit only these

   @dataclass
   class ExtraResult:
       signals: list[dict]             # filtered to EXTRA_CODES
       status: str                     # live | cached | off | error
       untrusted: dict[str, str]       # merged into result["untrusted_text"] (spotlighted for Claude)
       audit: dict                     # small, no seller text

   class Provider(Protocol):
       name: str
       def enabled(self) -> bool: ...
       async def startup(self) -> None: ...          # may start background work; must not block
       def reset(self) -> None: ...                  # called by reset_demo
       def signals(self, store: dict, flagged: list[dict], network: bool) -> ExtraResult: ...

   PROVIDERS: list[Provider] = []                    # S3 and S4 each append one line
   ```
   `run(store, flagged, network) -> (signals, sources, untrusted, audit)` calls each enabled provider in `try/except`: an exception → `status="error"`, no signals. Disabled → `status="off"`.
3. `tools.scan_store(store_id, listing=None, network=True)`: read `flagged = SELECT id, name FROM stores WHERE flagged = 1` in the existing connection, call `extras.run`, append signals before `score_store`, set `result["sources"] = {"sql": "live", **sources}`, merge `untrusted` into `result["untrusted_text"]`, put `audit` under `result["extras_audit"]`.
4. `policy.place_order`: call `scan_store(..., network=False)` at pay time. `check_policy` keeps `network=True`.
5. `agent._run_tool` (`scan_store` branch): add `sources` and `extras_audit` to the audit payload.
6. `main.py`: lifespan `await extras.startup()`; `reset_demo` calls `extras.reset()`; `/api/health` adds `"extras": {name: status}`.
7. Tests in `tests/test_extras.py` with fake providers: T6 (extras never make a score or tier better, for every seed listing); a provider emitting an unknown or gate code is ignored; a raising provider → `sources[name] == "error"` and the score is unchanged; `untrusted` text reaches `untrusted_text` only.

**Done when:** all tests green; with no providers registered, `/api/turn` output is identical to `main` apart from the new `sources` field.

**Out of scope:** any Senso or Cognee code.

---

## S3. Senso signal (backend)

**Goal:** `policy_red_flag` with a cited Senso passage; TechDeals goes 70 → 60 in the live demo.
**Plan:** §5 (all of it).

**Tasks**
1. **Spike S1 first (15 min):** ingest two tiny docs for two fake stores, wait for `complete`, try `/org/search/context` with `content_ids`. Record the result in `SENSO_SCOPE_FIELD` (field name, or empty for the filter fallback) and in "Plan corrections" below.
2. `schema.sql`: `senso_docs(store_id, content_id PRIMARY KEY, title, url)`. Don't add it to the `reset_and_seed` delete list.
3. `backend/seed/senso/<store_id>.txt` for the six stores in the §5 table (no SoundShack doc). Each starts with the store name and URL; no two are identical. The tester may rewrite the text; the phrases in §5 must stay.
4. `backend/scripts/seed_senso.py`: ingest each doc (title `"[store:<id>] <Name> — Returns"`), poll every 5 s until `complete`, write `senso_docs`. Skip docs already in `senso_docs`. Run it once against `shop_demo`.
5. `backend/app/senso.py` provider: `enabled()` = key set and `senso_docs` has rows; one `POST /org/search/context` per store (4 s timeout); keep passages that belong to the store and have `score ≥ SENSO_MIN_SCORE`; first `RED_FLAGS` match → signal with the fixed label, `source="Senso: <title>"`, `evidence_url` from `senso_docs`; passage (≤ 300 chars) → `untrusted["senso_passage"]`; audit `{content_id, title, score}`. In-process cache per store (`SENSO_CACHE_TTL_S`), `status="cached"` on a hit; `network=False` → cache only, else `"off"`. `startup()`/`reset()` warm the cache in a background thread.
6. Register it in `extras.PROVIDERS`.
7. T4 (§9.2) with `httpx.MockTransport`: red flag found; passage only under `untrusted_text`; timeout and 500 → `"error"`, no signal; no key → `"off"`; 402 → `"error"` and a log line.

**Done when:** T4 + all tests green; backend on `shop_demo` with the key: TechDeals shows 60 Caution with reason `Return policy says "store credit only"` · source `Senso: …`; `/api/health` shows `senso: live` (or `cached`); a second search makes no Senso calls (cache).

**Out of scope:** Senso prose answers, an `ask_store_policy` tool, scoring return or contact presence from Senso.

---

## S4. Cognee signal + NorthPeak seed (cut first)

**Goal:** `linked_two_hops` from a Cognee graph; NorthPeak goes Trusted → 70 Caution in the live demo.
**Plan:** §3.2 (NorthPeak entry), §6.

**Tasks**
1. **Spike S2 first, go/no-go by 2:00:** install Cognee into the backend venv from a new `backend/requirements-cognee.txt`. **Stop and report no-go** if it changes the installed `anthropic`, `openai`, `fastapi` or `pydantic` versions in a way that breaks the existing tests. Then write two `Store` DataPoints pointing at one fixed-ID `Address`, and check that `get_graph_data()` shows one Address node with two edges. Record the result in "Plan corrections".
2. `backend/app/graph.py`:
   - Pure function `two_hop(store_id, flagged_ids, attrs_by_store, stores_by_attr) -> path | None`, implementing the §6 rule (T ≠ S, F ≠ S, no direct S–F link). **No Cognee import at module level**, so tests run without Cognee installed.
   - Provider: `enabled()` = `COGNEE_ENABLED=1`; `startup()` imports Cognee lazily, `await get_graph_engine().get_graph_data()`, builds the two dicts (store IDs from the graph; **names come from SQL**, not from Cognee); load failure → status `error`. `signals()` only reads the dicts (no I/O). `reset()` does nothing (the graph doesn't change on reset).
   - Register it in `extras.PROVIDERS`.
3. `backend/scripts/seed_cognee.py`: DataPoints `Store`, `Address`, `Email`, `Phone` with `uuid5` fixed IDs and the normalization in §6, from the seeded `stores` table, via `add_data_points`. No `cognify`. **Run it with the backend stopped.**
4. `seed.py`: add NorthPeak Audio (`northpeak`, `l_northpeak`, $255, 300-day domain, card + PayPal, "30-day returns", own street address, phone `+12135550142`) and give AudioHub Direct the same phone. Update `test_demo_tiers` (`l_northpeak` → trusted, 100 offline) and any offer-count assertion (`grep -rn "offers" backend/tests`).
5. T5 (§9.2) on a hand-built adjacency: NorthPeak path `northpeak -phone- audiohub -address- gadgetflash`; AudioHub gets nothing from Cognee (direct link); a reported AudioHub turns NorthPeak's link direct (no two-hop signal).

**Done when:** T5 + all tests green without Cognee installed; demo backend with `COGNEE_ENABLED=1`: NorthPeak shows 70 Caution with `Linked to reported store GadgetFlash through AudioHub Direct` · `Cognee graph`; `/api/health` shows `cognee: live`; Best Buy is still the top pick.
**If no-go:** merge nothing from this step (not even NorthPeak). Tell S6.

**Out of scope:** reports or preferences in Cognee, `cognify`, Cognee search.

---

## S5. Firedrill harness (tester)

**Goal:** six scenarios ready to run against the local backend on `shop_drill`; one dry run done by 2:30.
**Plan:** §9.1.

**Tasks**
1. `backend/scripts/reset_drill_state.py`: parse the database name from `DATABASE_URL`; **refuse unless it ends in `_drill`**; run `init_db()`, `reset_and_seed()`, then `attacks.run("prompt_injection")` (policy injection for F3). Add T7 (refuses `shop_demo`, accepts `shop_drill`) in `tests/test_drill_reset.py`; it must not connect when it refuses.
2. `firedrill init` in `firedrill/`. Local plan: start `.venv/bin/python -m app` in `backend/`; readiness `/health`; `port_env: "PORT"`; driver exactly as in §9.1; `per_drill: true`; state hook `reset_drill_state.py`; env `SENSO_API_KEY=""`, `COGNEE_ENABLED=""`; `DATABASE_URL` (shop_drill) and `ANTHROPIC_API_KEY` under `local_secret_env`. Keep `local-plan.json` out of git (`.gitignore`).
3. Evaluations then scenarios for F1–F6 (F7, F8 written but run only if credits allow), as in the §9.1 table. Save with `firedrill library save --kind evaluation`, then `--kind scenario`.
4. **Concurrency check:** all drills share `shop_drill`. If Firedrill runs drills in parallel, set it to one at a time, or the resets will collide.
5. Dry run F4 only at ~2:30 with a throwaway plan. Screenshot it.

**Done when:** T7 green; the F4 dry run passes, or its failure is written up for the backend; all scenario files are in `firedrill/` (minus secrets).

**Out of scope:** the final campaign (S7), changing backend code (report problems instead).

---

## S6. Claims, README, Trust panel, voice delegation (frontend)

**Goal:** everything we say matches what runs.
**Plan:** §0, §2, §8 (voice), §9.3, §11.

**Tasks**
1. Run the §9.3 voice checklist. If "buy the Best Buy one" isn't delegated, add "the user wants to buy or picks an option" to the delegate list in `voice.py` `INSTRUCTIONS` and re-check.
2. `/api/trust` in `main.py`: add Senso ("policy passages for red-flag phrases; receives store names and our seeded policy docs, nothing about you") and Cognee ("store graph, runs inside our backend"), only for the ones that merged. Keep SingleStore if S0 is green; otherwise reword to "SQLite locally; schema is SingleStore-ready".
3. `README.md`: Claude for reasoning, GPT-Live for voice, SingleStore / Senso / Cognee as they actually ran, the Senso limitation (§5), `/chat` in the API table, Firedrill and pytest sections (results filled in at S7).
4. `.env.example`: all new variables from the table above, empty values.
5. `contracts/chat.request.json` and `contracts/chat.response.json` from a real `/chat` call.
6. Check that Senso and Cognee reasons show their `source` on the result cards (they should already).

**Done when:** a teammate reading the README and the Trust panel finds no claim that isn't true today.

---

## S7. Freeze QA + final campaign (3:20 → 3:50)

1. `pytest -q tests` on SQLite **and** with `TEST_DATABASE_URL=.../shop_drill`. Record the counts for the README.
2. Demo backend on `shop_demo`: `/api/health` shows `senso` and `cognee` live (or the step was cut); run the §11 demo script once end to end; `Verify trail` ✓.
3. **3:30 freeze.** Create the final Firedrill plan from the frozen tree, approve it, run F1–F6 (F7, F8 if credits allow). Screenshot the Simulations list and each Report tab into `docs/firedrill/`.
4. Fill in the README results. After this, fixes only, each with a re-run of pytest.

---

## Plan corrections

*(Sessions add one line each: step, what the plan got wrong, what you did.)*

- S0: `signal` is reserved on SingleStore, so quote that SQL column in schema/seed/tools/attacks; reference-table transactions require the master/DDL endpoint, so configure that endpoint. Added setup/test commands to README and database notes to `.env.example` for reproducibility.
- S1: `/chat` and a guarded `/policy-check` command already existed; preserved the command, applied the planned reply/status/session contract, and updated old assertions in `tests/test_api.py` that required the superseded reply format and session rejection.
