# AskDB

> Natural language to SQL, powered by Claude AI. Upload any CSV or query the demo music store — ask questions in plain English, get real data back instantly.

**[Live Demo](https://askdp.vercel.app)** · Phase 2 of 4

---

## What it does

Upload a CSV or use the built-in Chinook music store. Type a question like _"Which product generated the most revenue in Asia?"_ and AskDB:

1. Reads your live schema (introspected from Postgres, not hardcoded)
2. Sends the question + schema + recent conversation history to Claude
3. Receives back structured JSON: SQL query, suggested display columns, and a chart hint
4. Executes the SQL in a sandboxed read-only context, retrying with self-healing if it fails
5. Returns clean results — hiding primary keys and other noise unless you ask for them

No SQL knowledge required. Follow-up questions work: _"now break that down by month."_

## What's new in Phase 2

- **CSV upload + dynamic schema introspection.** Upload any CSV; it gets a session-scoped Postgres schema and the model queries it via live `information_schema` lookups — no hardcoded schemas.
- **Strategy C result presentation.** Single structured-output LLM call returns SQL + display columns + chart hint together. Resolved 6 of 7 Phase 1 partials by suppressing primary keys and other noise from output without adding latency.
- **Self-healing queries.** Failed SQL is automatically retried with the error fed back to Claude (up to 2 attempts). All retries logged to `query_retry_log` for analysis.
- **Conversation memory.** Last 4 exchanges sent as multi-turn history so follow-ups like _"break that down by month"_ resolve against prior context.
- **Headline eval result:** **100% pass rate (15/15)** on a CSV the model had never seen. Chinook regression rose from 53% strict accuracy in Phase 1 to **93%** in Phase 2. See [EVAL_PHASE_2.md](EVAL_PHASE_2.md) for full details.

---

## Demo

![Demo GIF](demo.gif)

---

## Architecture

![Architecture](architecture.png)

---

## Tech Stack

| Layer         | Technology                                      |
| ------------- | ----------------------------------------------- |
| Frontend      | Next.js 14, TypeScript, Tailwind CSS, shadcn/ui |
| Backend       | Python, FastAPI, uvicorn                        |
| AI            | Anthropic Claude (claude-sonnet-4-5)            |
| Database      | PostgreSQL (Neon serverless)                    |
| Deployment    | Vercel (frontend), Railway (backend)            |
| Observability | Sentry, query logging, token tracking           |

---

## For Running locally

### Prerequisites

- Node.js 22+
- Python 3.12+
- Docker

### Backend

```bash
cd api
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend

```bash
cd web
npm install
npm run dev
```

### Environment variables

Create `askdp/.env`:

- ANTHROPIC_API_KEY=your_key_here
- DATABASE_URL=your_postgres_url
- SENTRY_DSN=your_sentry_dsn

Create `askdp/web/.env.local`:

- NEXT_PUBLIC_API_URL=http://127.0.0.1:8000

---

## Known Limitations

These are real — not excuses, just honest engineering notes:

- **Business-logic ambiguity remains** — fuzzy terms like "most popular" are interpreted silently. The model picks one definition (e.g. `COUNT` vs `SUM`) without surfacing the choice. Phase 3 work.
- **No auth** — anyone with the URL can query. Rate limiting (10/min per IP) is the only guard.
- **CSV inserts are row-by-row** — uploads >5,000 rows will be slow. `executemany` / `COPY` planned.
- **Date types in CSV upload aren't inferred** — dates land as TEXT and the model has to wrap in `TO_DATE(...)`. Works, but adds latency on date-math questions.
- **Neon cold starts** — first query after inactivity can be slow (~2–3s).
- **Tested mainly on schemas in-distribution for the model** — a truly adversarial schema test (domain-specific data the model has never seen) is still pending.

---

## What's coming (Phase 3)

- [ ] Semantic layer / clarification step for business-logic ambiguity ("popular," "top," "active")
- [ ] Auth + per-user query history
- [ ] Faster CSV ingest (batch INSERT or COPY)
- [ ] Latency optimisation for date-heavy queries
- [ ] Adversarial eval on a truly out-of-distribution schema

---

## Phase 2 checklist (shipped)

- [x] Auto-chart rendering — backend returns `chart_hint`, frontend renders 6 chart types (bar/line/pie/scatter/grouped-bar) via Recharts with heuristic fallback, plus smart cell formatting (currency, dates, durations, percentages)
- [x] Dynamic schema introspection — works on any uploaded CSV via session-scoped Postgres schemas
- [x] Conversation memory — last 4 exchanges sent as multi-turn history
- [x] Self-healing queries — retry with error context when SQL fails (up to 2 attempts)
- [x] Result presentation layer (Strategy C) — structured LLM output suppresses primary keys and other noise
- [x] Eval on a CSV the model has never seen — 15/15 (100%) on uploaded online sales data

---

## Query Log

Every question asked is logged to Postgres with: question, generated SQL, result count, token usage, and duration. Failed queries and self-healing retries are logged separately to `query_retry_log`. This powers the eval sets and ongoing improvement work.

---

Built by [Munya](https://github.com/NhanahMunya) · Chinook dataset by [lerocha](https://github.com/lerocha/chinook-database)
