# Search Strategies Comparison & Benchmark Analysis

This document compares the three search strategies (**PostgreSQL ILIKE**, **PostgreSQL Full-Text Search**, and **Elasticsearch**) based on real benchmark tests run in our system.

---

## 🧪 How We Tested in Our System

> ⚠️ **Important Context: This is One Query for One Common Word**  
> Every benchmark number in this table represents a **single query for one common word: `"database"`**.  
> In our 100,000 document corpus, `"database"` is a high-frequency term that matches **12,511 documents (~12.5% of the entire dataset)**. On top of filtering, the queries calculated a full corpus match count (`count(*) OVER ()` in PostgreSQL, `track_total_hits: true` in Elasticsearch).  
> **Do not interpret "ILIKE: ~558 ms" as ILIKE's general speed.** Trigrams are fast for selective, rare terms (e.g. SKUs, emails, rare names). When a word appears in over 12,000 documents, PostgreSQL must scan and intersect massive trigram inverted lists and compute window counts across 12,511 rows, which causes the severe latency drop shown below.

- **Dataset:** 100,000 technical articles/documents from CSV (~91 MB).
  - Columns: `id`, `title`, `summary`, `content`, `tags`, `author`, `category` (concatenated into `searchable_text`).
- **Hardware & Environment:**
  - **Host Machine:** 12th Gen Intel Core i5-12450H (8 cores / 12 threads), 16 GB RAM, Windows 11.
  - **Docker Containers:** PostgreSQL 16 Alpine, Elasticsearch 8.19.0 (single-node, `ES_JAVA_OPTS: -Xms512m -Xmx512m`).
- **Search Query:** Single common word `"database"`.
- **Total Iterations:** 100 sequential runs (after warm-up passes).
- **Scope:** Full corpus scan (calculating total match count across all 100,000 documents) while returning the top 5 filtered results.
- **Latency Measured:** End-to-end application round-trip time (`Dashboard ➔ Express API ➔ Database / Search Engine ➔ Dashboard`).

> ℹ️ **Benchmark Fluctuations:**  
> When running benchmarks locally, results can **fluctuate** based on background OS processes, CPU thermal states, Docker desktop virtualization overhead, and memory/disk cache warming. These numbers reflect a stable, warmed run intended to demonstrate relative orders of magnitude between the three strategies rather than absolute production SLAs.

---

## 🔬 The Queries Actually Benchmarked

To ensure reproducible results, here are the exact queries executed by the benchmark suite:

### 1. PostgreSQL ILIKE (`pg_trgm`)
```sql
WITH matched AS (
  SELECT id, document, count(*) OVER () AS total_count
  FROM documents
  WHERE searchable_text ILIKE '%' || $1 || '%'
)
SELECT id, document, total_count
FROM matched
LIMIT 5;
```

### 2. PostgreSQL Full-Text Search (FTS)
```sql
WITH parsed_query AS (
  SELECT websearch_to_tsquery('english', $1) AS value
),
matched AS (
  SELECT d.id, d.document, ts_rank(d.search_vector, q.value) AS score, count(*) OVER () AS total_count
  FROM documents d
  CROSS JOIN parsed_query q
  WHERE d.search_vector @@ q.value
)
SELECT id, document, score, total_count
FROM matched
ORDER BY score DESC
LIMIT 5;
```

### 3. Elasticsearch
```json
{
  "index": "search_documents",
  "size": 5,
  "track_total_hits": true,
  "query": {
    "multi_match": {
      "query": "database",
      "fields": ["searchable_text"],
      "operator": "and"
    }
  }
}
```

*Note: In both PostgreSQL queries, `count(*) OVER ()` forces PostgreSQL to count all 12,511 matches across the 100,000 rows. Without `count(*) OVER ()`, queries with `LIMIT 5` would terminate as soon as 5 rows were found, making ILIKE appear significantly faster than it actually performs in real pagination workflows.*

---

## 📏 Understanding Benchmark Metrics (In One Line Each)

- **Min:** The absolute fastest single search response recorded out of 100 runs.
- **Average:** The total time of all 100 runs divided by 100.
- **p50 (Median):** 50% of requests were faster than this (what a typical user experiences).
- **p95:** 95% of requests finished within this time (shows latency during occasional spikes).
- **p99:** 99% of requests finished within this time (worst-case tail latency).
- **Max:** The single slowest search response recorded across all 100 runs.
- **QPS (Queries Per Second):** How many sequential search requests the engine processed per second.
- **Matches:** Total number of documents in the 100,000 dataset that matched `"database"`.

---

## 📊 Actual Benchmark Results

Results from searching the common word `"database"` over **100,000 documents** across **100 sequential iterations** (post warm-up):

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
- **Why it behaves like this:** Trigrams break words into 3-character slices (`dat`, `ata`, `tab`, `aba`, `bas`, `ase`). Because `"database"` is a common word matching 12,511 documents, Postgres has to pull, union, and filter huge trigram index entries, re-check table heap rows, and calculate `count(*) OVER ()` across all 12,511 matching rows.
- **Verdict:** Great for substring and partial matching on selective queries, but severely degrades on frequent whole words with large result sets.

### 2. PostgreSQL FTS — ~121 ms avg (8.26 QPS)
- **Why it behaves like this:** It searches pre-built word vectors (`tsvector`) rather than 3-letter substrings. It is **4.6x faster** than ILIKE because matching stemmed word tokens through a GIN index requires much less work, and it scores rows using `ts_rank`.
- **Verdict:** The best built-in PostgreSQL choice for natural language search without running separate infrastructure.

### 3. Elasticsearch — ~8.09 ms avg (123.35 QPS)
- **Why it behaves like this:** Elasticsearch keeps its inverted index and term dictionaries optimized in memory. Counting total hits (`track_total_hits: true`) is nearly instant in Lucene, avoiding table heap scans.
- **Verdict:** **~15x faster than FTS** and **~69x faster than ILIKE**, with single-digit millisecond latency (5.60 ms min). The runaway winner for scale and high query throughput.

---

### 💡 Why did Elasticsearch find 11,912 matches while Postgres found 12,511?

The **599-document difference** (12,511 vs 11,912) is caused by **plural stemming**:

1. **Elasticsearch used the `standard` analyzer:**  
   The `standard` analyzer tokenizes words and converts them to lowercase, but **does not perform English stemming**. When searching for the singular token `"database"`, documents that only contained the plural `"databases"` did not match.
2. **PostgreSQL FTS used the `'english'` dictionary:**  
   PostgreSQL's English configuration runs the Snowball stemmer, which reduces both `"database"` and `"databases"` to the common stem `'databas'`. Hence, searching for `"database"` matched both forms.
3. **PostgreSQL ILIKE used substring matching:**  
   `'%database%'` naturally matches the substring `"database"` inside the plural `"databases"`.

**Verification on the dataset:**  
Querying the corpus confirmed there are **exactly 599 documents** (e.g. `doc_000377`, `doc_000591`, `doc_000766`) that contain the plural `"Databases"` (in their `category` or `tags`) but never contain the singular word `"database"`.  
- Elasticsearch singular query `"database"`: **11,912**
- Documents with only plural `"databases"`: **599**
- Total: **11,912 + 599 = 12,511** (matching PostgreSQL exactly).
- When Elasticsearch is queried for `("database" OR "databases")`, it returns the exact same **12,511** matches.

---

## 🏆 Quick Decision Matrix: Which Should You Use?

> *Note on thresholds: The row count guidance below represents rough rules of thumb. Our benchmark specifically measured 100,000 rows.*

| Scenario | Recommended Strategy | Why? |
|---|---|---|
| Need substring / partial matching (e.g. emails, usernames, parts of serial numbers, SKUs) | **PostgreSQL ILIKE (`pg_trgm`)** | Only engine here that naturally matches arbitrary character chunks. Fast on selective queries, but avoid for high-frequency terms. |
| Natural language search with relevance ranking on small-to-medium datasets (rough rule of thumb: up to hundreds of thousands of rows) | **PostgreSQL FTS** | Respectable latency (~120ms), ranks results with `ts_rank`, and requires zero extra infrastructure. |
| High data volume, high concurrent search traffic, or single-digit millisecond SLA required (rough rule of thumb: multi-million rows or when search I/O degrades the primary database) | **Elasticsearch** | Single-digit millisecond responses (~8 ms), Lucene inverted index, horizontally scalable, and isolates search load from transactional databases. |
