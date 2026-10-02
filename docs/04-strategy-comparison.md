# Search Strategies Comparison & Benchmark Analysis

This document compares the three search strategies (**PostgreSQL ILIKE**, **PostgreSQL Full-Text Search**, and **Elasticsearch**) based on real benchmark tests run in our system.

---

## 🧪 How We Tested in Our System

- **Dataset:** 100,000 documents imported from CSV into both PostgreSQL and Elasticsearch under identical conditions.
- **Search Query:** `"database"`
- **Total Iterations:** 100 sequential runs (after warm-up passes).
- **Scope:** Full corpus scan (calculating total match count across all 100,000 documents) while returning the top 5 filtered results.
- **Latency Measured:** End-to-end application round-trip time (`Dashboard ➔ API Server ➔ Database / Engine ➔ Dashboard`).

---

## 📏 Understanding Benchmark Metrics (In One Line Each)

- **Min:** The absolute fastest single search response recorded out of 100 runs.
- **Average:** The total time of all 100 runs divided by 100.
- **p50 (Median):** 50% of your requests were faster than this (what a typical user experiences).
- **p95:** 95% of requests finished within this time (shows latency during occasional spikes).
- **p99:** 99% of requests finished within this time (worst-case tail latency for users).
- **Max:** The single slowest search response recorded across all 100 runs.
- **QPS (Queries Per Second):** How many search requests the engine can process in one second.
- **Matches:** Total number of documents in the 100,000 dataset that matched the word `"database"`.

---

## 📊 Actual Benchmark Results

Here are the real test results from searching `"database"` over **100,000 documents** across **100 iterations**:

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `540.48 ms` | `557.98 ms` | `550.45 ms` | `598.45 ms` | `645.93 ms` | `664.93 ms` | **1.79** | 12,511 |
| **PostgreSQL FTS** | `92.43 ms` | `121.02 ms` | `116.74 ms` | `150.22 ms` | `168.33 ms` | `176.17 ms` | **8.26** | 12,511 |
| **Elasticsearch** | `5.60 ms` | `8.09 ms` | `7.60 ms` | `9.53 ms` | `14.97 ms` | `46.16 ms` | **123.35** | 11,912 |

---

## 🔍 Understanding the Behavior: Why the Big Difference?

```
                     Average Latency (Lower is Better)
Elasticsearch   █ 8.09 ms  (69x faster than ILIKE, 15x faster than FTS)
Postgres FTS    █████████████ 121.02 ms
Postgres ILIKE  ██████████████████████████████████████████████████ 557.98 ms
```

### 1. PostgreSQL ILIKE (`pg_trgm`) — ~558 ms avg (1.79 QPS)
- **Why it behaves like this:** Trigrams break words into 3-character slices (`dat`, `ata`, `tab`, `aba`, `bas`, `ase`). Searching for a frequent word like `"database"` forces Postgres to combine many trigram lists and then calculate `count(*) OVER ()` across 12,511 matching rows.
- **Verdict:** Powerful for partial words and substrings, but heavy and slow for frequent whole-word searches.

### 2. PostgreSQL FTS — ~121 ms avg (8.26 QPS)
- **Why it behaves like this:** It searches pre-built word vectors (`tsvector`) rather than individual characters. It is **4.6x faster** than ILIKE because matching whole words through a GIN index requires far less work, and it automatically ranks results with `ts_rank`.
- **Verdict:** The best built-in PostgreSQL choice for natural language search without adding extra services.

### 3. Elasticsearch — ~8.09 ms avg (123.35 QPS)
- **Why it behaves like this:** Elasticsearch keeps its inverted index and term dictionaries optimized in memory. Counting total hits (`track_total_hits: true`) is instantaneous in Lucene compared to scanning rows in relational storage.
- **Verdict:** **~15x faster than FTS** and **~69x faster than ILIKE**. The runaway winner for scale and high query throughput.

> 💡 **Why did Elasticsearch find 11,912 matches while Postgres found 12,511?**  
> Different tokenizers! PostgreSQL's English dictionary and Elasticsearch's standard analyzer tokenize punctuation, special characters, and compound words slightly differently.

---

## 🏆 Quick Decision Matrix: Which Should You Use?

| Scenario | Recommended Strategy | Why? |
|---|---|---|
| Need substring / partial matching (e.g. emails, usernames, parts of serial numbers) | **PostgreSQL ILIKE (`pg_trgm`)** | Only engine here that naturally matches arbitrary character chunks. |
| Standard search with relevance ranking on small-to-medium datasets | **PostgreSQL FTS** | Fast enough (~120ms), ranks results, and requires zero extra servers. |
| Large dataset (>500k rows), high traffic, or sub-10ms response times required | **Elasticsearch** | Built specifically for heavy search workloads and horizontal scale. |
