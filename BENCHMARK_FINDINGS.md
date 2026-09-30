# Search Benchmark Findings

This document explains the observed performance differences between:

- PostgreSQL `ILIKE`
- PostgreSQL Full-Text Search (FTS)
- Elasticsearch

The benchmark uses a dataset of **100,000 documents** and measures search latency across repeated sequential queries.

## Benchmark setup

Each benchmark:

- Uses the same dataset for all three engines.
- Runs the same search query against all engines.
- Uses a result limit of **20 documents**.
- Performs a warmup before the measured iterations.
- Measures latency over repeated searches.
- Reports min, average, p50, p95, p99, max, and QPS.

The important point is that the benchmark does **not** show that one engine is always faster. The result depends heavily on the workload.

---

# 1. No-match query

### Query

```text
benchmarkneedle
```

This term does not exist in the dataset, so all engines return:

```text
0 results
```

### 100,000 documents — 1,000 iterations

| Engine | Average | p50 | p95 | p99 | Max | QPS |
|---|---:|---:|---:|---:|---:|---:|
| PostgreSQL ILIKE | **557.62 ms** | 536.46 ms | 662.71 ms | 879.28 ms | 1806.36 ms | 1.79 |
| PostgreSQL FTS | **1.26 ms** | 1.26 ms | 1.70 ms | 1.92 ms | 2.24 ms | 792.19 |
| Elasticsearch | **7.57 ms** | 6.23 ms | 15.70 ms | 21.90 ms | 47.26 ms | 131.99 |

### What happened?

This is the workload where `ILIKE` performs very poorly.

The query is effectively:

```sql
WHERE searchable_text ILIKE '%' || $1 || '%'
LIMIT 20
```

Because there are **zero matching documents**, PostgreSQL cannot satisfy the `LIMIT 20` early.

It must continue examining rows until it has searched the table and determined that there are no matches.

The result is a large scan of the 100,000-document dataset.

PostgreSQL FTS and Elasticsearch use indexed search structures, allowing them to determine that the term has no matches without performing the same kind of full table scan.

For this workload:

- ILIKE averaged **557.62 ms**
- PostgreSQL FTS averaged **1.26 ms**
- Elasticsearch averaged **7.57 ms**

The ILIKE query was therefore much more expensive for this particular workload.

---

# 2. Common query

### Query

```text
distributed systems
```

This query has many matching documents.

### 100,000 documents — 1,000 iterations

| Engine | Average | p50 | p95 | p99 | Max | QPS |
|---|---:|---:|---:|---:|---:|---:|
| PostgreSQL ILIKE | **3.30 ms** | 3.21 ms | 4.11 ms | 4.91 ms | 7.17 ms | 302.64 |
| PostgreSQL FTS | **20.59 ms** | 20.32 ms | 22.71 ms | 25.35 ms | 36.48 ms | 48.54 |
| Elasticsearch | **3.63 ms** | 3.55 ms | 4.41 ms | 5.56 ms | 7.08 ms | 274.57 |

All three engines returned:

```text
20 results
```

### Why is ILIKE fast here?

`ILIKE` is still using a scan-based approach, but the query has a `LIMIT 20`.

There are many matching documents, so PostgreSQL can find 20 matching rows relatively early and stop.

It does not necessarily need to examine all 100,000 rows.

Therefore, even though ILIKE does not have an inverted search index, it can still be very fast for a query where matching rows are encountered early.

This explains why ILIKE averaged only **3.30 ms** in this workload.

---

# 3. Why the results are different

The important distinction is:

> **ILIKE performance depends heavily on how far PostgreSQL has to scan before it can satisfy the query.**

### No matches

```text
100,000 rows
        ↓
scan
        ↓
no match
        ↓
continue scanning
        ↓
end of table
```

There are no results, so `LIMIT 20` cannot help.

Result:

```text
ILIKE ≈ 557 ms
```

### Many matches

```text
row 1
row 2
row 3
...
matching rows
...
20 matches found
        ↓
      STOP
```

The `LIMIT 20` can allow the query to stop much earlier.

Result:

```text
ILIKE ≈ 3.3 ms
```

Therefore, the statement:

> "ILIKE is always slow"

would be incorrect.

A more accurate statement is:

> **ILIKE is a scan-based search strategy whose latency can increase substantially when the database must examine a large portion of the table before finding enough matches or determining that no matches exist.**

---

# 4. Why indexed search behaves differently

PostgreSQL FTS and Elasticsearch use indexed search structures designed to locate terms rather than repeatedly scanning every document.

Conceptually:

### ILIKE

```text
Query
  ↓
Check document 1
  ↓
Check document 2
  ↓
Check document 3
  ↓
...
```

The amount of work depends heavily on where enough matches are found.

### PostgreSQL FTS

```text
Query
  ↓
Full-text index
  ↓
Locate matching terms
  ↓
Matching documents
```

### Elasticsearch

```text
Query
  ↓
Inverted index
  ↓
Locate matching terms
  ↓
Matching documents
```

The indexed approaches therefore have a fundamentally different access pattern.

---

# 5. An important observation: PostgreSQL FTS was not always fastest

The common-query benchmark produced an interesting result:

```text
ILIKE          3.30 ms
Elasticsearch  3.63 ms
PostgreSQL FTS 20.59 ms
```

So PostgreSQL FTS was actually slower than both ILIKE and Elasticsearch for this particular query.

This does not contradict the benchmark.

The three implementations are not identical internally.

The PostgreSQL FTS implementation also performs relevance ranking using `ts_rank()` and orders the matching documents by score.

Therefore, its measured latency includes more work than simply locating matching terms.

The benchmark should therefore not be interpreted as:

```text
FTS > Elasticsearch > ILIKE
```

or any other universal ranking.

Instead, it demonstrates that **different search strategies have different performance characteristics depending on the workload and operations performed.**

---

# 6. What the benchmark demonstrates

The benchmark demonstrates an important property of search systems:

> **Search performance is workload-dependent.**

For the 100,000-document dataset:

### No-match workload

```text
ILIKE          557.62 ms
FTS              1.26 ms
Elasticsearch    7.57 ms
```

ILIKE becomes expensive because it must search the dataset without being able to stop after finding 20 matches.

### Common-match workload

```text
ILIKE            3.30 ms
FTS              20.59 ms
Elasticsearch     3.63 ms
```

ILIKE performs well because many matching documents allow the `LIMIT 20` condition to be satisfied early.

---

# 7. Main takeaway

The goal of this benchmark is not to prove that one search engine is universally faster.

Instead, it demonstrates the trade-off between **scan-based substring search** and **indexed search**.

PostgreSQL `ILIKE` is simple and can perform well when matches are found early, especially on relatively small datasets or common queries.

However, when the query produces few or no matches, the database may need to examine a large portion of the dataset. As the dataset grows, this can become increasingly expensive.

PostgreSQL FTS and Elasticsearch use indexes designed for term-based search, allowing them to avoid the same full-table scanning behavior.

The key lesson is:

> **The performance of a search query depends not only on the amount of data, but also on the search strategy, query selectivity, number of matches, and amount of work required after matching.**
