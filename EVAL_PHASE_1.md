# EVAL_PHASE_1.md — AskDB Text-to-SQL Evaluation

## Purpose

Measure how well the Phase 1 system translates natural language to correct SQL on the Chinook database. The goals are to:

- Quantify baseline correctness (% of questions answered right)
- Identify recurring failure patterns
- Build the seed set the Phase 4 eval suite will extend

---

## How to use this file

For each question:

1. **Establish ground truth first.** Connect to your Neon Postgres (e.g. via `psql` or DBeaver) and run the _Ground-truth SQL_ listed below. Record what comes back.
2. **Ask AskDB the question.** Paste the natural-language question into the live site.
3. **Compare.** Did AskDB's SQL return the same answer as the ground truth?
4. **Record the result.** Fill in the `Status` and `Failure mode` columns at the bottom of this file.

---

## The 15 questions

### Tier 1 — Trivial (single-table, no joins)

These should all pass. If any fail, something is broken at a basic level.

**Q1. How many customers do we have?**

- Ground-truth SQL: `SELECT COUNT(*) FROM customer;`
- Expected: a single number around `59`.
- Watch for: model returning a table-scan instead of `COUNT(*)`.

**Q2. How many tracks are in the database?**

- Ground-truth SQL: `SELECT COUNT(*) FROM track;`
- Expected: a single number around `3503`.
- Watch for: same as above.

**Q3. List all genres.**

- Ground-truth SQL: `SELECT name FROM genre ORDER BY name;`
- Expected: about `25` rows including names like Rock, Jazz, Metal, Latin, Pop, Classical.
- Watch for: model adding unnecessary joins or filtering.

**Q4. How many employees work here?**

- Ground-truth SQL: `SELECT COUNT(*) FROM employee;`
- Expected: `8`.
- Watch for: model interpreting "work" as a filter (e.g. by hire date).

---

### Tier 2 — Easy (single table + WHERE / ORDER BY)

These should mostly pass. Failures here usually indicate schema-comprehension issues.

**Q5. What is the most expensive track?**

- Ground-truth SQL: `SELECT name, unit_price FROM track ORDER BY unit_price DESC LIMIT 1;`
- Expected: a track at the highest `unit_price` (Chinook has tracks at `$0.99` and `$1.99` — answer should be a `$1.99` track).
- Watch for: model returning multiple rows because of price ties (this is technically correct but UX-confusing).

**Q6. List all customers from Brazil.**

- Ground-truth SQL: `SELECT first_name, last_name, city FROM customer WHERE country = 'Brazil';`
- Expected: around `5` customers.
- Watch for: case-sensitivity issues, model querying `billing_country` on `invoice` instead of `country` on `customer`.

**Q7. What is the average track length in minutes?**

- Ground-truth SQL: `SELECT AVG(milliseconds) / 60000.0 AS avg_minutes FROM track;`
- Expected: roughly `~6.5` minutes.
- Watch for: model returning milliseconds without conversion, or doing integer division.

**Q8. Who is the longest-tenured employee?**

- Ground-truth SQL: `SELECT first_name, last_name, hire_date FROM employee ORDER BY hire_date ASC LIMIT 1;`
- Expected: a single employee (in standard Chinook, Andrew Adams, hired 2002).
- Watch for: model misinterpreting "longest-tenured" as oldest by birthdate (no such column) or as highest title.

---

### Tier 3 — Medium (multi-table joins, aggregates)

This is where the project starts earning its keep. Expect some failures.

**Q9. Top 5 customers by total spend.**

- Ground-truth SQL:
  ```sql
  SELECT c.first_name, c.last_name, SUM(i.total) AS total_spend
  FROM customer c
  JOIN invoice i ON c.customer_id = i.customer_id
  GROUP BY c.customer_id, c.first_name, c.last_name
  ORDER BY total_spend DESC
  LIMIT 5;
  ```
- Expected: 5 rows. In standard Chinook, top customers spend around `$49`.
- Watch for: missing GROUP BY columns, joining on wrong key, model using `invoice_line.unit_price * quantity` instead of `invoice.total`.

**Q10. Total revenue by country.**

- Ground-truth SQL:
  ```sql
  SELECT billing_country, SUM(total) AS revenue
  FROM invoice
  GROUP BY billing_country
  ORDER BY revenue DESC;
  ```
- Expected: ~24 country rows. USA usually highest, around `$523`.
- Watch for: model joining through `customer.country` instead of using `invoice.billing_country` (these can differ).

**Q11. Which album has the most tracks?**

- Ground-truth SQL:
  ```sql
  SELECT a.title, COUNT(t.track_id) AS track_count
  FROM album a
  JOIN track t ON a.album_id = t.album_id
  GROUP BY a.album_id, a.title
  ORDER BY track_count DESC
  LIMIT 1;
  ```
- Expected: a single album with around `34` tracks (in standard Chinook this is _Greatest Hits_ by Iron Maiden or similar).
- Watch for: model returning multiple rows on ties, missing LIMIT.

**Q12. Top 3 artists by total revenue.**

- Ground-truth SQL:
  ```sql
  SELECT ar.name, SUM(il.unit_price * il.quantity) AS revenue
  FROM artist ar
  JOIN album al ON ar.artist_id = al.artist_id
  JOIN track t ON al.album_id = t.album_id
  JOIN invoice_line il ON t.track_id = il.track_id
  GROUP BY ar.artist_id, ar.name
  ORDER BY revenue DESC
  LIMIT 3;
  ```
- Expected: 3 rows. Iron Maiden typically tops the list.
- Watch for: model missing a join in the chain (artist → album → track → invoice_line), hallucinating an `artist_id` on `invoice` or `track`.

---

### Tier 4 — Hard (date math, business-logic ambiguity, complex joins)

Most failures live here. These are the questions that will define your Phase 2 priorities.

**Q13. What was monthly revenue in 2010?**

- Ground-truth SQL:
  ```sql
  SELECT DATE_TRUNC('month', invoice_date) AS month, SUM(total) AS revenue
  FROM invoice
  WHERE EXTRACT(YEAR FROM invoice_date) = 2010
  GROUP BY month
  ORDER BY month;
  ```
- Expected: 12 rows, one per month of 2010.
- Watch for: model using `EXTRACT(MONTH ...)` without year filter, returning text dates instead of proper month grouping, using MySQL-style functions on Postgres.

**Q14. Which genre is most popular in Germany?**

- Ground-truth SQL (interpretation: by quantity of tracks sold to German customers):
  ```sql
  SELECT g.name, SUM(il.quantity) AS units_sold
  FROM genre g
  JOIN track t ON g.genre_id = t.genre_id
  JOIN invoice_line il ON t.track_id = il.track_id
  JOIN invoice i ON il.invoice_id = i.invoice_id
  WHERE i.billing_country = 'Germany'
  GROUP BY g.genre_id, g.name
  ORDER BY units_sold DESC
  LIMIT 1;
  ```
- Expected: typically `Rock` or `Alternative & Punk` for Germany.
- Watch for: **this is the classic business-logic ambiguity question.** "Most popular" could mean: most units sold, most unique customers, most revenue, most listens. The model usually picks one without asking. _Note which interpretation it picks._ This finding is gold for Phase 2.

**Q15. Which employee generated the most sales revenue?**

- Ground-truth SQL:
  ```sql
  SELECT e.first_name, e.last_name, SUM(i.total) AS revenue
  FROM employee e
  JOIN customer c ON e.employee_id = c.support_rep_id
  JOIN invoice i ON c.customer_id = i.customer_id
  GROUP BY e.employee_id, e.first_name, e.last_name
  ORDER BY revenue DESC
  LIMIT 1;
  ```
- Expected: a single employee (in standard Chinook, Jane Peacock).
- Watch for: model going `employee → invoice` directly (no such join — must route through `customer.support_rep_id`). Hallucinated `employee_id` on `invoice` is the most common failure here.

---

## Results

Fill this in after running all 15 questions through AskDB.

| #   | Question                        | Tier | Status | Failure mode (if failed)                                                                                                                                                        |
| --- | ------------------------------- | ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | How many customers?             | 1    | ✅     |                                                                                                                                                                                 |
| 2   | How many tracks?                | 1    | ✅     |                                                                                                                                                                                 |
| 3   | List all genres                 | 1    | ✅     |                                                                                                                                                                                 |
| 4   | How many employees?             | 1    | ✅     |                                                                                                                                                                                 |
| 5   | Most expensive track            | 2    | ⚠️     | Returns all (\*) data in table instead of limiting to neccesary columns                                                                                                         |
| 6   | Customers from Brazil           | 2    | ⚠️     | Correct but Selected unnecesary id                                                                                                                                              |
| 7   | Average track length in minutes | 2    | ✅     |                                                                                                                                                                                 |
| 8   | Longest-tenured employee        | 2    | ⚠️     | Correct but Selected unnecesary id                                                                                                                                              |
| 9   | Top 5 customers by spend        | 3    | ⚠️     | Correct but Selected unnecesary id                                                                                                                                              |
| 10  | Total revenue by country        | 3    | ✅     |                                                                                                                                                                                 |
| 11  | Album with most tracks          | 3    | ⚠️     | Correct but Selected unnecesary id                                                                                                                                              |
| 12  | Top 3 artists by revenue        | 3    | ✅     |                                                                                                                                                                                 |
| 13  | Monthly revenue in 2010         | 4    | ✅     |                                                                                                                                                                                 |
| 14  | Most popular genre in Germany   | 4    | ⚠️     | Model used COUNT(purchases), ground truth used SUM(units). Same answer in Chinook because quantity=1 always, but silent business-logic assumption — would diverge on real data. |
| 15  | Top employee by sales revenue   | 4    | ⚠️     | Correct but Selected unnecesary id                                                                                                                                              |

`✅` for pass, `❌` for fail, `⚠️` for partial (Correct intent, wrong details).

---

## Summary

**Overall pass rate:** `8 / 15` (`53%`)

**By tier:**

- Tier 1 (Trivial): `4 / 4`
- Tier 2 (Easy): `1 / 4`
- Tier 3 (Medium): `2 / 4`
- Tier 4 (Hard): `1 / 3`

---

## Failure patterns

After completing the table, group the failures into 3–4 recurring patterns. Examples of patterns you might see:

- **Business-logic ambiguity** — "popular," "best," "top," "active" interpreted without asking the user.
- **Technical correctness** — Technically correct results with extra columns like primary keys

```
Pattern 1: Business-logic ambiguity
- Observed on questions: Q14 (most popular genre in Germany). .
- Description: The model encounters a fuzzy business term ("popular,"
  "most sales") and silently picks one interpretation from several valid
  ones, without surfacing the choice to the user. On Q14, it chose
  "count of purchase events" while the ground truth used "sum of units sold."
  In Chinook the two collapse to the same answer because quantity is always 1,
  so the failure was masked — but on any real dataset the answers would
  diverge.
- Likely cause: No semantic layer defining business terms. LLM is trained
  to produce confident answers rather than ask clarifying questions. Model
  has no way to know which interpretation the asker had in mind.
- Phase 2 implication: Add a clarification step when ambiguous terms are
  detected, OR build a small semantic layer mapping common business terms
  to explicit SQL fragments for this schema.

Pattern 2: Technical correctness with noisy output
- Observed on questions: Q9 (top 5 customers by spend).
- Description: SQL executes correctly and the answer is mathematically right,
  but the result set includes columns the user didn't ask for and wouldn't
  want — in Q9, the model returned customer_id alongside name and spend.
  Strictly correct, but introduces friction for non-technical users who
  have to mentally filter the output.
- Likely cause: LLMs are trained on SQL corpora heavy with SELECT * and
  verbose example queries that include primary keys "for completeness."
  The model has no signal about what the rendering surface looks like or
  who the audience is. It optimizes for "answer the question completely"
  rather than "answer minimally and cleanly."
- Phase 2 implication: Either prompt the model toward minimal columns
  (cheap, partial fix), or add a result-presentation layer that decides
  which columns to show based on the question type (cleaner, more work).

> The dominant failure mode is output noise (6 of 7 partials) rather than SQL incorrectness. Phase 2 will therefore prioritize a result-presentation layer over prompting changes, and will introduce CSV upload to test the system on databases outside Chinook to ensure the 100% execution accuracy isn't an artifact of dataset familiarity.
```

---

## Implications for Phase 2

One paragraph. Based on what you observed, what's the highest-leverage fix?

Examples of conclusions a Phase 1 eval might lead to:

- _"Schema retrieval is needed — Phase 2 should embed schema and retrieve only relevant tables per question."_
- _"A semantic layer for business terms ('popular', 'top customer') is needed — these account for the majority of failures and can't be fixed by better prompting alone."_

---

## Cost & latency notes

Optional but valuable. After the run:

- Average tokens per question: `~495 in / 64 out`
- Average latency: `~ 3.9 seconds`
- Estimated cost per 1,000 questions: `~$2.45`
