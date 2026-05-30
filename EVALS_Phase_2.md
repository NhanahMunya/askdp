# AskDB Eval Report

**Run at:** 2026-05-30 18:29  
**API:** Local (`http://127.0.0.1:8000`)  
**Questions:** 15

## Summary

| Metric        | Value   |
| ------------- | ------- |
| ✅ Pass       | 10      |
| ⚠️ Partial    | 4       |
| ❌ Fail       | 1       |
| 🔴 Error      | 0       |
| **Pass rate** | **67%** |
| Avg latency   | 3.49s   |

## Results by tier

**Tier 1:** 1/4 passed
**Tier 2:** 4/4 passed
**Tier 3:** 4/4 passed
**Tier 4:** 1/3 passed

## Full results

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
| 13  | 4    | What was monthly revenue in 2010?                | ✅ Pass    |                                                                                                                                                               | 3.1s     |
| 14  | 4    | Which genre is most popular in Germany?          | ⚠️ PARTIAL | Used wrong logic; used count instead of sum in this db it will give correct answer but others will be a different case Row count mismatch: got 10, expected 1 | 3.97s    |
| 15  | 4    | Which employee generated the most sales revenue? | ✅ PASS    |                                                                                                                                                               | 3.45s    |

## Generated SQL

### Q1 ✅ — How many customers do we have?

```sql
SELECT COUNT(*) AS customer_count FROM customer
```

### Q2 ✅ — How many tracks are in the database?

```sql
SELECT COUNT(*) AS track_count FROM track
```

### Q3 ✅ — List all genres.

```sql
SELECT name FROM genre ORDER BY name
```

### Q4 ✅ — How many employees work here?

```sql
SELECT COUNT(*) AS employee_count FROM employee
```

### Q5 ✅ — What is the most expensive track?

```sql
SELECT t.name AS track_name, a.title AS album_title, ar.name AS artist_name, t.unit_price FROM track t JOIN album a ON t.album_id = a.album_id JOIN artist ar ON a.artist_id = ar.artist_id ORDER BY t.unit_price DESC LIMIT 1
```

### Q6 ✅ — List all customers from Brazil.

```sql
SELECT first_name, last_name, email, city FROM customer WHERE country = 'Brazil' ORDER BY last_name, first_name
```

### Q7 ✅ — What is the average track length in minutes?

```sql
SELECT ROUND(AVG(milliseconds) / 60000.0, 2) AS average_track_length_minutes FROM track
```

### Q8 ✅ — Who is the longest-tenured employee?

```sql
SELECT first_name, last_name, title, hire_date, CURRENT_DATE - hire_date::date AS days_employed FROM employee ORDER BY hire_date ASC LIMIT 1
```

### Q9 ✅ — Top 5 customers by total spend.

```sql
SELECT c.first_name, c.last_name, c.email, SUM(i.total) AS total_spend FROM customer c JOIN invoice i ON c.customer_id = i.customer_id GROUP BY c.customer_id, c.first_name, c.last_name, c.email ORDER BY total_spend DESC LIMIT 5
```

### Q10 ✅ — Total revenue by country.

```sql
SELECT billing_country AS country, SUM(total) AS total_revenue FROM invoice GROUP BY billing_country ORDER BY total_revenue DESC
```

### Q11 ✅ — Which album has the most tracks?

```sql
SELECT a.title AS album_title, ar.name AS artist_name, COUNT(t.track_id) AS track_count FROM album a JOIN artist ar ON a.artist_id = ar.artist_id JOIN track t ON a.album_id = t.album_id GROUP BY a.album_id, a.title, ar.name ORDER BY track_count DESC LIMIT 1
```

### Q12 ✅ — Top 3 artists by total revenue.

```sql
SELECT ar.name AS artist_name, ROUND(SUM(il.unit_price * il.quantity), 2) AS total_revenue FROM artist ar JOIN album al ON ar.artist_id = al.artist_id JOIN track t ON al.album_id = t.album_id JOIN invoice_line il ON t.track_id = il.track_id GROUP BY ar.artist_id, ar.name ORDER BY total_revenue DESC LIMIT 3
```

### Q13 ✅ — What was monthly revenue in 2010?

```sql
SELECT DATE_TRUNC('month', invoice_date) AS month, SUM(total) AS revenue FROM invoice WHERE EXTRACT(YEAR FROM invoice_date) = 2010 GROUP BY DATE_TRUNC('month', invoice_date) ORDER BY month
```

### Q14 ⚠️ — Which genre is most popular in Germany?

```sql
SELECT g.name AS genre, COUNT(il.invoice_line_id) AS purchases FROM invoice i JOIN invoice_line il ON i.invoice_id = il.invoice_id JOIN track t ON il.track_id = t.track_id JOIN genre g ON t.genre_id = g.genre_id WHERE i.billing_country = 'Germany' GROUP BY g.name ORDER BY purchases DESC LIMIT 10
```

### Q15 ✅ — Which employee generated the most sales revenue?

```sql
SELECT e.first_name, e.last_name, SUM(i.total) AS total_sales FROM employee e JOIN customer c ON e.employee_id = c.support_rep_id JOIN invoice i ON c.customer_id = i.customer_id GROUP BY e.employee_id, e.first_name, e.last_name ORDER BY total_sales DESC LIMIT 1
```
