## Purpose

This document is the initial evaluation seed set for the early Text-to-SQL model using the Chinook sample database.

> The goals are:

- Measure basic SQL generation correctness
- Identify failure patterns
- Track improvements over time
- Build the foundation for the larger evaluation suite in Phase 4

# Evaluation Instructions

For each question:

1. Run the prompt through the Text-to-SQL model
2. Execute the generated SQL against the Chinook database
3. Compare the result against the expected answer/query intent
4. Mark PASS or FAIL
5. Record failure reasons when applicable

Suggested failure categories:

- Wrong table
- Wrong join
- Missing aggregation
- Incorrect filtering
- Hallucinated column/table
- Syntax error
- Incorrect grouping
- Date handling issue
- Ordering/ranking issue
- Partial answer

---

# Evaluation Questions

| #   | Difficulty | Question                                                          | Concepts Tested                        | Status | Failure Notes |
| --- | ---------- | ----------------------------------------------------------------- | -------------------------------------- | ------ | ------------- |
| 1   | Trivial    | How many customers are in the database?                           | COUNT, single table                    | Pass   |               |
| 2   | Trivial    | How many employees are there?                                     | COUNT, single table                    | TBD    |               |
| 3   | Trivial    | List all music genres alphabetically.                             | SELECT, ORDER BY                       | Pass   |               |
| 4   | Easy       | What is the total revenue across all invoices?                    | SUM aggregation                        | PASS   |               |
| 5   | Easy       | What are the top 5 customers by total spend?                      | JOIN, GROUP BY, ORDER BY, LIMIT        | PASS   |               |
| 6   | Easy       | Which country has the most customers?                             | GROUP BY, COUNT, sorting               | TBD    |               |
| 7   | Easy       | Which employee supports the most customers?                       | JOIN, aggregation                      | TBD    |               |
| 8   | Medium     | What are the top 10 best-selling tracks by quantity sold?         | Multi-join, aggregation                | Pass   |               |
| 9   | Medium     | Which genre has the highest number of tracks?                     | JOIN, GROUP BY                         | TBD    |               |
| 10  | Medium     | Show monthly revenue for 2010.                                    | Date filtering, grouping by month      | TBD    |               |
| 11  | Medium     | Which customers have never made a purchase?                       | LEFT JOIN, NULL filtering              | TBD    |               |
| 12  | Medium     | Which artists have the most albums?                               | JOIN, aggregation                      | TBD    |               |
| 13  | Medium     | What is the average invoice total by country?                     | GROUP BY, AVG                          | TBD    |               |
| 14  | Hard       | Which genre is most popular in Germany?                           | Multi-join, filtering, aggregation     | TBD    |               |
| 15  | Hard       | Which employees generated the most sales revenue?                 | Multi-table joins, aggregation         | TBD    |               |
| 16  | Hard       | What are the top 3 artists by revenue generated?                  | Complex joins, SUM aggregation         | TBD    |               |
| 17  | Hard       | Which playlists contain tracks from more than 5 different genres? | Multi-join, DISTINCT COUNT             | TBD    |               |
| 18  | Hard       | Find customers who purchased tracks from more than 3 genres.      | Multi-join, DISTINCT aggregation       | TBD    |               |
| 19  | Expert     | Which album generated the highest revenue in 2009?                | Advanced joins, filtering, aggregation | TBD    |               |
| 20  | Expert     | For each country, show the top customer by spending.              | Window functions or subqueries         | TBD    |               |
