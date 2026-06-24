# LOG.md — AskDB build log

A running log of decisions, surprises, and lessons. Written in present-tense as work happens; this file is the source for interview talking points later.

---

## Phase 3 · Day 1–2 — Latency observability and the schema cache fix

### Why this work

By the end of Phase 2 I knew queries took ~3.5 seconds on average, but I had no idea *where* that time was going. One number. Useless for optimization — you can't fix what you can't see.

The principle I went in with: instrument first, optimize second. Most engineers skip the instrumentation step and guess at the bottleneck. Then they ship "caching" or "async" without actually verifying it helped. I wanted real numbers before touching anything.

### What I built

**Day 1 — Instrumentation.** Added six timing columns to `query_log` (`schema_resolution_ms`, `schema_introspection_ms`, `llm_call_ms`, `sql_execution_ms`, `heal_retry_ms`, `retry_count`) and a small `stopwatch()` closure for measuring each phase inline. Wrapped each phase of the `/api/ask` flow with its own timer. Made sure timings flow through error paths too — when the safety check rejects a non-SELECT query, the partial timings still get logged. Most engineers lose this data; I deliberately didn't.

**Day 2 — Schema introspection cache.** With instrumentation in place, the data showed schema introspection running on *every* query for CSV-uploaded sessions, even though the schema doesn't change within a session. Added `SCHEMA_CACHE` — an in-memory dict keyed on `session_id`, storing the fully-formatted schema context string (not just the columns array — caches the formatting work too). Cache hits skip both the `information_schema.columns` query and the string formatting; `schema_introspection_ms` on a hit drops to ~1ms. Cache miss paths still log the real introspection cost so I can measure the cache's value empirically. Added a TTL to prevent the cache from growing unbounded.

### What the numbers showed

After ~30 queries logged:

| Phase                    | Avg     | Notes                              |
| ------------------------ | ------- | ---------------------------------- |
| `schema_resolution_ms`   | 1,015ms | Surprisingly expensive             |
| `schema_introspection_ms`| 378ms   | Mix of cache hits and misses       |
| `llm_call_ms`            | 3,516ms | Dominant cost, as expected         |
| `sql_execution_ms`       | 534ms   | Lower than expected                |
| **P50 total**            | 3,758ms | Half of users feel this            |
| **P95 total**            | 12,507ms| Worst 1-in-20 query                |

### What surprised me

**The LLM dominating wasn't the surprise — that I predicted.** What surprised me was schema *resolution* — just looking up which schema to use for a session — averaging over a second. That's a `SELECT schema_name, table_name FROM upload_sessions WHERE session_id = %s` query. It should be milliseconds, not a second. Most likely cause: I'm opening a fresh psycopg connection on every request instead of pooling, and Neon's serverless Postgres has a cold-start tax on each new connection.

**The other surprise: P95.** P50 of 3.8 seconds looks fine. P95 of 12.5 seconds is the actual user pain — one in twenty users waits over twelve seconds, almost certainly the cold-connection path plus self-healing retries firing. Production engineers obsess over tail latency, not averages, because tails are what lose users. I now understand why.

### The deeper lesson

I went into this assuming the LLM was the obvious bottleneck (and it is — 94% of average wall time). But the highest-leverage *fix* available to me isn't the LLM — that cost lives at Anthropic's infrastructure, not mine. The highest-leverage fix I can ship is on the second-largest cost (schema resolution) that's entirely under my control.

That's the principle: **don't optimize what's expensive; optimize what's expensive *and yours*.** A senior engineer doesn't say "the LLM is slow" — they say "the LLM is slow and unfixable from here, but the 1-second connection overhead is self-inflicted and shrinkable to 50ms with pooling."

### What I'd do next (Phase 3 continued)

1. **Connection pooling.** Use `psycopg_pool` or pgbouncer-style pooling so we're not paying connection cost on every request. Predicted impact: kill the 1s schema resolution, probably 200–400ms off P50 and noticeably more off P95.
2. **Separate cache-hit vs cache-miss metrics.** Re-run the percentile query splitting on whether `schema_introspection_ms < 50`. Currently I have to eyeball the cache benefit; I should be able to read it directly.
3. **Stream the LLM response.** Wall time stays the same but perceived latency drops dramatically — first token in ~400ms instead of waiting 3.5s for the full SQL.

### Interview takeaway

Three things I can now say with evidence:

- *"P50 was 3.8s but P95 was 12.5s — the bigger problem was the tail, not the average."*
- *"The LLM dominated wall time, but the optimization I shipped wasn't on the LLM — that cost isn't mine to optimize. It was on a 1-second connection-overhead path I only saw after instrumenting."*
- *"I caught the schema introspection running on every query before any caching was in place. Adding the cache cut it from ~400ms to ~1ms on hits. Measured it before and after, didn't guess."*

That sequence — *instrument → measure → identify the surprising bottleneck → fix the one that's yours to fix* — is the production-engineering loop I want to be known for.

---
