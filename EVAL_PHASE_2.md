# EVAL_PHASE_2.md — AskDB Phase 2 Evaluation

## Overview

Two evals were run for Phase 2:

1. **Chinook regression eval** — the original Phase 1 question set, re-run after Phase 2 changes (Strategy C structured output, self-healing retries, conversation memory) to measure improvement.
2. **Bring-Your-Own-Data eval** — a brand-new 15-question set against an uploaded CSV (`online_sales_data`) the model had never seen. This validates the dynamic-schema introspection pipeline end-to-end and tests how the system performs on schemas outside Chinook.

## Headline results

| Eval                          | Pass / Partial / Fail | Pass rate | Avg latency | Notes                                                       |
| ----------------------------- | --------------------- | --------- | ----------- | ----------------------------------------------------------- |
| Chinook regression            | 14 / 1 / 0            | **93%**   | 3.49s       | Strict accuracy. Up from 53% in Phase 1. Execution acc 100%. |
| Online Sales CSV (unseen)     | 15 / 0 / 0            | **100%**  | 4.85s       | First end-to-end test of dynamic schema introspection.       |

Key takeaway: the result-presentation layer (Strategy C) resolved 6 of 7 Phase 1 partials, and the dynamic-schema pipeline performed perfectly on a CSV the model had not seen.

---

## Eval 1: Chinook regression

**Run at:** 2026-05-30 18:29  
**API:** Local (`http://127.0.0.1:8000`)  
**Questions:** 15 (same set as Phase 1)

### Summary

| Metric        | Value   |
| ------------- | ------- |
| ✅ Pass       | 14      |
| ⚠️ Partial    | 1       |
| ❌ Fail       | 0       |
| 🔴 Error      | 0       |
| **Pass rate** | **93%** |
| Avg latency   | 3.49s   |

### Results by tier

- **Tier 1:** 4/4 passed
- **Tier 2:** 4/4 passed
- **Tier 3:** 4/4 passed
- **Tier 4:** 2/3 passed

### Full results

| #   | Tier | Question                                         | Status     | Reason                                                                                                                                                        | Duration |
| --- | ---- | ------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | 1    | How many customers do we have?                   | ✅ PASS    |                                                                                                                                                               | 4.11s    |
| 2   | 1    | How many tracks are in the database?             | ✅ PASS    |                                                                                                                                                               | 2.72s    |
| 3   | 1    | List all genres.                                 | ✅ PASS    |                                                                                                                                                               | 2.8s     |
| 4   | 1    | How many employees work here?                    | ✅ PASS    |                                                                                                                                                               | 3.22s    |
| 5   | 2    | What is the most expensive track?                | ✅ PASS    |                                                                                                                                                               | 3.65s    |
| 6   | 2    | List all customers from Brazil.                  | ✅ PASS    |                                                                                                                                                               | 2.96s    |
| 7   | 2    | What is the average track length in minutes?     | ✅ PASS    |                                                                                                                                                               | 3.07s    |
| 8   | 2    | Who is the longest-tenured employee?             | ✅ PASS    |                                                                                                                                                               | 3.15s    |
| 9   | 3    | Top 5 customers by total spend.                  | ✅ PASS    |                                                                                                                                                               | 3.76s    |
| 10  | 3    | Total revenue by country.                        | ✅ PASS    |                                                                                                                                                               | 2.74s    |
| 11  | 3    | Which album has the most tracks?                 | ✅ PASS    |                                                                                                                                                               | 5.28s    |
| 12  | 3    | Top 3 artists by total revenue.                  | ✅ PASS    |                                                                                                                                                               | 4.37s    |
| 13  | 4    | What was monthly revenue in 2010?                | ✅ PASS    |                                                                                                                                                               | 3.1s     |
| 14  | 4    | Which genre is most popular in Germany?          | ⚠️ PARTIAL | Used wrong logic; used count instead of sum in this db it will give correct answer but others will be a different case Row count mismatch: got 10, expected 1 | 3.97s    |
| 15  | 4    | Which employee generated the most sales revenue? | ✅ PASS    |                                                                                                                                                               | 3.45s    |

### Generated SQL

#### Q1 ✅ — How many customers do we have?

```sql
SELECT COUNT(*) AS customer_count FROM customer
```

#### Q2 ✅ — How many tracks are in the database?

```sql
SELECT COUNT(*) AS track_count FROM track
```

#### Q3 ✅ — List all genres.

```sql
SELECT name FROM genre ORDER BY name
```

#### Q4 ✅ — How many employees work here?

```sql
SELECT COUNT(*) AS employee_count FROM employee
```

#### Q5 ✅ — What is the most expensive track?

```sql
SELECT t.name AS track_name, a.title AS album_title, ar.name AS artist_name, t.unit_price FROM track t JOIN album a ON t.album_id = a.album_id JOIN artist ar ON a.artist_id = ar.artist_id ORDER BY t.unit_price DESC LIMIT 1
```

#### Q6 ✅ — List all customers from Brazil.

```sql
SELECT first_name, last_name, email, city FROM customer WHERE country = 'Brazil' ORDER BY last_name, first_name
```

#### Q7 ✅ — What is the average track length in minutes?

```sql
SELECT ROUND(AVG(milliseconds) / 60000.0, 2) AS average_track_length_minutes FROM track
```

#### Q8 ✅ — Who is the longest-tenured employee?

```sql
SELECT first_name, last_name, title, hire_date, CURRENT_DATE - hire_date::date AS days_employed FROM employee ORDER BY hire_date ASC LIMIT 1
```

#### Q9 ✅ — Top 5 customers by total spend.

```sql
SELECT c.first_name, c.last_name, c.email, SUM(i.total) AS total_spend FROM customer c JOIN invoice i ON c.customer_id = i.customer_id GROUP BY c.customer_id, c.first_name, c.last_name, c.email ORDER BY total_spend DESC LIMIT 5
```

#### Q10 ✅ — Total revenue by country.

```sql
SELECT billing_country AS country, SUM(total) AS total_revenue FROM invoice GROUP BY billing_country ORDER BY total_revenue DESC
```

#### Q11 ✅ — Which album has the most tracks?

```sql
SELECT a.title AS album_title, ar.name AS artist_name, COUNT(t.track_id) AS track_count FROM album a JOIN artist ar ON a.artist_id = ar.artist_id JOIN track t ON a.album_id = t.album_id GROUP BY a.album_id, a.title, ar.name ORDER BY track_count DESC LIMIT 1
```

#### Q12 ✅ — Top 3 artists by total revenue.

```sql
SELECT ar.name AS artist_name, ROUND(SUM(il.unit_price * il.quantity), 2) AS total_revenue FROM artist ar JOIN album al ON ar.artist_id = al.artist_id JOIN track t ON al.album_id = t.album_id JOIN invoice_line il ON t.track_id = il.track_id GROUP BY ar.artist_id, ar.name ORDER BY total_revenue DESC LIMIT 3
```

#### Q13 ✅ — What was monthly revenue in 2010?

```sql
SELECT DATE_TRUNC('month', invoice_date) AS month, SUM(total) AS revenue FROM invoice WHERE EXTRACT(YEAR FROM invoice_date) = 2010 GROUP BY DATE_TRUNC('month', invoice_date) ORDER BY month
```

#### Q14 ⚠️ — Which genre is most popular in Germany?

```sql
SELECT g.name AS genre, COUNT(il.invoice_line_id) AS purchases FROM invoice i JOIN invoice_line il ON i.invoice_id = il.invoice_id JOIN track t ON il.track_id = t.track_id JOIN genre g ON t.genre_id = g.genre_id WHERE i.billing_country = 'Germany' GROUP BY g.name ORDER BY purchases DESC LIMIT 10
```

*Same business-logic-ambiguity pattern observed in Phase 1: model picked `COUNT(invoice_line_id)` (purchase events) as its definition of "popular," while the ground truth used `SUM(quantity)` (units sold). In Chinook these collapse to the same answer because `quantity = 1` always, so the failure is masked. Additionally regressed from Phase 1: model now returns `LIMIT 10` instead of `LIMIT 1` despite the question saying "most popular" (singular) — likely a side-effect of the new structured-output prompt encouraging broader result sets.*

#### Q15 ✅ — Which employee generated the most sales revenue?

```sql
SELECT e.first_name, e.last_name, SUM(i.total) AS total_sales FROM employee e JOIN customer c ON e.employee_id = c.support_rep_id JOIN invoice i ON c.customer_id = i.customer_id GROUP BY e.employee_id, e.first_name, e.last_name ORDER BY total_sales DESC LIMIT 1
```

---

## Eval 2: Bring-Your-Own-Data (Online Sales CSV)

**Run at:** 2026-06-02 11:10  
**API:** Local (`http://127.0.0.1:8000`)  
**Questions:** 15  
**Dataset:** `online_sales_data` (CSV uploaded via `/api/upload`)  
**Session schema:** `session_94759d778639.online_sales_data`

This is the first end-to-end test of the dynamic-schema pipeline. The CSV was uploaded, parsed by pandas, materialized into a session-scoped Postgres schema, and introspected at query time. The model never saw the schema before generation — it received it via the live `information_schema.columns` lookup.

### Summary

| Metric        | Value    |
| ------------- | -------- |
| ✅ Pass       | 15       |
| ⚠️ Partial    | 0        |
| ❌ Fail       | 0        |
| 🔴 Error      | 0        |
| **Pass rate** | **100%** |
| Avg latency   | 4.85s    |

### Results by tier

- **Tier 1:** 4/4 passed
- **Tier 2:** 4/4 passed
- **Tier 3:** 4/4 passed
- **Tier 4:** 3/3 passed

### Full results

| #   | Tier | Question                                                       | Status  | Reason | Duration |
| --- | ---- | -------------------------------------------------------------- | ------- | ------ | -------- |
| 1   | 1    | How many transactions are there?                               | ✅ PASS |        | 4.15s    |
| 2   | 1    | How many unique products are sold?                             | ✅ PASS |        | 4.12s    |
| 3   | 1    | How many transactions came from North America?                 | ✅ PASS |        | 3.97s    |
| 4   | 1    | What is the most used payment method?                          | ✅ PASS |        | 3.93s    |
| 5   | 2    | What is the total revenue across all transactions?             | ✅ PASS |        | 3.72s    |
| 6   | 2    | What is the most expensive single transaction?                 | ✅ PASS |        | 4.83s    |
| 7   | 2    | What is the total revenue from Electronics?                    | ✅ PASS |        | 4.0s     |
| 8   | 2    | What is the average order value for each payment method?       | ✅ PASS |        | 4.28s    |
| 9   | 3    | What is the total revenue by region?                           | ✅ PASS |        | 4.18s    |
| 10  | 3    | What is the total revenue by product category?                 | ✅ PASS |        | 4.85s    |
| 11  | 3    | Which product had the most units sold in total?                | ✅ PASS |        | 3.81s    |
| 12  | 3    | What is the average number of units sold per product category? | ✅ PASS |        | 4.49s    |
| 13  | 4    | What was the monthly total revenue for 2024?                   | ✅ PASS |        | 8.02s    |
| 14  | 4    | Which month had the highest total revenue?                     | ✅ PASS |        | 9.58s    |
| 15  | 4    | Which product generated the most revenue in Asia?              | ✅ PASS |        | 4.82s    |

### Generated SQL

#### Q1 ✅ — How many transactions are there?

```sql
SELECT COUNT(*) as transaction_count FROM session_94759d778639.online_sales_data
```

#### Q2 ✅ — How many unique products are sold?

```sql
SELECT COUNT(DISTINCT product_name) AS unique_products FROM session_94759d778639.online_sales_data
```

#### Q3 ✅ — How many transactions came from North America?

```sql
SELECT COUNT(*) as transaction_count FROM session_94759d778639.online_sales_data WHERE region = 'North America'
```

#### Q4 ✅ — What is the most used payment method?

```sql
SELECT payment_method, COUNT(*) as transaction_count FROM session_94759d778639.online_sales_data GROUP BY payment_method ORDER BY transaction_count DESC LIMIT 1
```

#### Q5 ✅ — What is the total revenue across all transactions?

```sql
SELECT SUM(total_revenue) as total_revenue FROM session_94759d778639.online_sales_data
```

#### Q6 ✅ — What is the most expensive single transaction?

```sql
SELECT transaction_id, date, product_category, product_name, units_sold, unit_price, total_revenue, region, payment_method FROM session_94759d778639.online_sales_data ORDER BY total_revenue DESC LIMIT 1
```

*Strategy C correctly relaxed its column filter here — "most expensive single transaction" is a "show me the record" question, so returning all columns including `transaction_id` is the right call. Different behavior from aggregate questions like Q9 where IDs were suppressed.*

#### Q7 ✅ — What is the total revenue from Electronics?

```sql
SELECT SUM(total_revenue) as total_revenue FROM session_94759d778639.online_sales_data WHERE product_category = 'Electronics'
```

#### Q8 ✅ — What is the average order value for each payment method?

```sql
SELECT payment_method, ROUND(AVG(total_revenue)::numeric, 2) as average_order_value FROM session_94759d778639.online_sales_data GROUP BY payment_method ORDER BY average_order_value DESC
```

#### Q9 ✅ — What is the total revenue by region?

```sql
SELECT region, SUM(total_revenue) as total_revenue FROM session_94759d778639.online_sales_data GROUP BY region ORDER BY total_revenue DESC
```

#### Q10 ✅ — What is the total revenue by product category?

```sql
SELECT product_category, SUM(total_revenue) as total_revenue FROM session_94759d778639.online_sales_data GROUP BY product_category ORDER BY total_revenue DESC
```

#### Q11 ✅ — Which product had the most units sold in total?

```sql
SELECT product_name, SUM(units_sold) as total_units_sold FROM session_94759d778639.online_sales_data GROUP BY product_name ORDER BY total_units_sold DESC LIMIT 1
```

#### Q12 ✅ — What is the average number of units sold per product category?

```sql
SELECT product_category, ROUND(AVG(units_sold)::numeric, 2) as average_units_sold FROM session_94759d778639.online_sales_data GROUP BY product_category ORDER BY average_units_sold DESC
```

#### Q13 ✅ — What was the monthly total revenue for 2024?

```sql
SELECT TO_CHAR(TO_DATE(date, 'YYYY-MM-DD'), 'YYYY-MM') as month, SUM(total_revenue) as monthly_revenue FROM session_94759d778639.online_sales_data WHERE EXTRACT(YEAR FROM TO_DATE(date, 'YYYY-MM-DD')) = 2024 GROUP BY TO_CHAR(TO_DATE(date, 'YYYY-MM-DD'), 'YYYY-MM') ORDER BY month
```

*Note: CSV upload preserved `date` as TEXT (no type inference for dates). Model correctly worked around this by wrapping in `TO_DATE(...)` for date math. Worth tracking — future improvement could auto-detect date columns at upload time.*

#### Q14 ✅ — Which month had the highest total revenue?

```sql
SELECT TO_CHAR(TO_DATE(date, 'YYYY-MM-DD'), 'YYYY-MM') as month, SUM(total_revenue) as total_revenue FROM session_94759d778639.online_sales_data GROUP BY TO_CHAR(TO_DATE(date, 'YYYY-MM-DD'), 'YYYY-MM') ORDER BY total_revenue DESC LIMIT 1
```

#### Q15 ✅ — Which product generated the most revenue in Asia?

```sql
SELECT product_name, SUM(total_revenue) as total_revenue FROM session_94759d778639.online_sales_data WHERE region = 'Asia' GROUP BY product_name ORDER BY total_revenue DESC LIMIT 1
```

---

## Findings

### Phase 2 wins (vs Phase 1)

1. **Strategy C resolved 6 of 7 Phase 1 partials.** Every previously-noisy result (Q5 SELECT-star, Q6/Q8/Q9/Q11/Q15 ID-dumping) now returns clean human-friendly columns. The structured output approach (model returns `sql` + `display_columns` in one call) eliminated noise without adding a second LLM round-trip.
2. **Dynamic schema pipeline works end-to-end.** CSV → pandas → typed Postgres table → live introspection → SQL generation → execution succeeded on every question for a schema the model never saw.
3. **Strict accuracy rose from 53% to 93% on Chinook**, and the unseen dataset hit 100%. Execution accuracy was 100% on both.

### Open issues

- **Business-logic ambiguity (Q14 Chinook).** The same Phase 1 pattern persists: "most popular" interpreted silently as `COUNT(events)` rather than `SUM(units)`. Phase 3 should consider a clarification step or a small semantic-layer hook for business terms.
- **Q14 LIMIT regression.** Model now returns top-10 even when the question is singular ("the most popular"). Likely a side-effect of the structured-output prompt encouraging broader output. Worth a prompt tweak.
- **Latency increased 39%** (3.49s → 4.85s) on the unseen schema. Hard date-math questions (Q13, Q14 in BYOD) hit 8–9 seconds. Acceptable for a demo, but Phase 3 should benchmark and consider streaming.
- **"Unseen" is relative.** The Online Sales schema (`transaction_id`, `product_category`, `region`, `payment_method`) is in-distribution for e-commerce training data. A truly adversarial test (e.g. domain-specific schemas like farming or industrial IoT) is still pending.

### Cost & latency notes

- Avg latency: 3.49s (Chinook), 4.85s (BYOD)
- Latency tail: 8–9s on date-math questions over CSV-uploaded data
- Estimated cost per 1000 questions: ~$2.45 (no significant change from Phase 1 despite added structured output and conversation memory — token overhead absorbed by tighter SQL)
