# Search Strategies Comparison & Benchmark Analysis

A comprehensive technical evaluation comparing **PostgreSQL ILIKE (`pg_trgm`)**, **PostgreSQL Full-Text Search (FTS)**, and **Elasticsearch** over a 100,000-document dataset, backed by actual benchmark runs from the lab environment (`result/test 1.png` through `result/test 8.png`).

---

## 🧪 Benchmark Environment & Testing Methodology

- **Corpus:** 100,000 technical articles (~91 MB CSV).
  - Columns: `id` (primary key), `title`, `summary`, `content`, `tags`, `author`, `category` concatenated into `searchable_text`.
- **Query Execution:**
  - Evaluates both **top-5 filtered retrieval** and the **total matching document count** across the entire 100,000-row corpus (`count(*) OVER ()` in PostgreSQL, `track_total_hits: true` in Elasticsearch).
  - Matches real-world paginated search UIs (e.g. "Showing 1–5 of 12,511 matches").
- **Iteration Protocol:**
  - 10 warm-up iterations executed first to stabilize caches.
  - 100 sequential benchmark iterations recorded per engine.
  - Queries run sequentially (`searchAllSequential` / `runBenchmark`) to eliminate CPU core and buffer cache contention between database engines.
- **Latency Measurement:** End-to-end application round-trip time (`React Dashboard ➔ Express API ➔ Database / Search Engine ➔ React Dashboard`).

---

## 🔬 The Queries Actually Executed

To ensure full reproducibility, here are the exact queries executed in `services/search.ts`:

### 1. PostgreSQL ILIKE (`pg_trgm`)
```sql
WITH matched AS (
  SELECT id, document, count(*) OVER () AS total_count
  FROM documents
  WHERE searchable_text ILIKE '%' || $1 || '%'
)
SELECT id, document, total_count
FROM matched
LIMIT $2;
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
LIMIT $2;
```

### 3. Elasticsearch
```json
{
  "index": "search_documents",
  "size": 5,
  "track_total_hits": true,
  "query": {
    "multi_match": {
      "query": "user_query",
      "fields": ["searchable_text^3", "searchable_text.partial"],
      "operator": "and"
    }
  }
}
```

---

## 📏 Understanding Latency Percentiles & Benchmark Metrics (One-Line Definitions)

- **p0 (Min):** The absolute fastest single search response recorded across all iterations.
- **p10:** 10% of requests finished within this time (represents optimal warmed-cache performance).
- **p50 (Median):** 50% of requests were faster than this time (what a typical user experiences under steady state).
- **p90:** 90% of requests finished within this time (marks the threshold before tail latency starts).
- **p95:** 95% of requests finished within this time (standard industry SLA target for acceptable service latency).
- **p99:** 99% of requests finished within this time (worst-case tail latency experienced during GC or I/O spikes).
- **p99.9:** 99.9% of requests finished within this time (extreme 1-in-1,000 outlier latency).
- **p100 (Max):** The single slowest search response recorded across the entire benchmark run.
- **Average (Mean):** The total execution time of all requests divided by the iteration count.
- **QPS (Queries Per Second):** How many sequential search queries the engine completed per second (`iterations / total_time_in_seconds`).
- **Matches:** Total number of documents across the entire 100,000 dataset satisfying the query criteria.

---

## 📊 Complete Benchmark Results Across All 8 Scenarios

Below are the exact metrics recorded across the 8 test runs stored in the `result/` directory (`database.png`, `Replication.png`, `replications.png`, `container.png`, `containers.png`, `artificial.png`, `kuber.png`, `postgr.png`):

### Test 1: Query `"database"` (Common Word — 12.5% of Corpus)
*Tests common single-word lookup and plural category tokenization.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `125.33 ms` | `141.84 ms` | `132.77 ms` | `174.11 ms` | `204.91 ms` | `345.42 ms` | **7.05** | 12,511 |
| **PostgreSQL FTS** | `123.06 ms` | `142.57 ms` | `135.76 ms` | `196.03 ms` | `208.05 ms` | `212.47 ms` | **7.01** | 12,511 |
| **Elasticsearch** | `30.41 ms` | `42.97 ms` | `42.57 ms` | `59.88 ms` | `82.24 ms` | `84.30 ms` | **23.25** | **12,511** |

---

### Test 2: Query `"Replication"` (High-Frequency Term — 23.7% of Corpus)
*Tests engine scaling when matches encompass nearly a quarter of the entire dataset.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `422.46 ms` | `474.05 ms` | `461.76 ms` | `534.47 ms` | `651.82 ms` | `701.70 ms` | **2.11** | 23,666 |
| **PostgreSQL FTS** | `369.31 ms` | `414.81 ms` | `403.73 ms` | `483.38 ms` | `618.01 ms` | `662.94 ms` | **2.41** | 23,666 |
| **Elasticsearch** | `32.20 ms` | `50.12 ms` | `43.88 ms` | `90.76 ms` | `102.34 ms` | `102.73 ms` | **19.95** | **23,666** |

---

### Test 3: Query `"replications"` (Plural Variant — Stemming Test)
*Tests whether engines recognize plural queries when the dataset only contains singular forms.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `183.08 ms` | `210.58 ms` | `204.50 ms` | `265.75 ms` | `355.92 ms` | `409.13 ms` | **4.75** | **0** |
| **PostgreSQL FTS** | `371.81 ms` | `408.26 ms` | `397.28 ms` | `456.18 ms` | `596.90 ms` | `614.91 ms` | **2.45** | **23,666** |
| **Elasticsearch** | `32.47 ms` | `57.69 ms` | `47.95 ms` | `102.83 ms` | `117.00 ms` | `139.82 ms` | **17.33** | **23,666** |

---

### Test 4: Query `"container"` (Singular Query — Dataset Contains Plural "containers")
*Tests singular-to-plural match behavior via linguistic stemming.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `129.78 ms` | `164.87 ms` | `152.58 ms` | `205.51 ms` | `328.77 ms` | `408.64 ms` | **6.07** | **11,908** |
| **PostgreSQL FTS** | `140.85 ms` | `169.19 ms` | `157.33 ms` | `209.63 ms` | `307.03 ms` | `410.24 ms` | **5.91** | **11,908** |
| **Elasticsearch** | `28.29 ms` | `48.12 ms` | `40.12 ms` | `87.23 ms` | `109.58 ms` | `116.53 ms` | **20.77** | **11,908** |

---

### Test 5: Query `"containers"` (Plural Query Matching Plural Data)
*Validates that plural-to-plural exact token queries match correctly across all three engines.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `131.83 ms` | `159.66 ms` | `148.01 ms` | `206.68 ms` | `224.49 ms` | `227.11 ms` | **6.26** | 11,908 |
| **PostgreSQL FTS** | `141.69 ms` | `177.21 ms` | `162.08 ms` | `215.99 ms` | `339.37 ms` | `450.43 ms` | **5.64** | 11,908 |
| **Elasticsearch** | `29.20 ms` | `52.04 ms` | `40.76 ms` | `102.69 ms` | `117.94 ms` | `126.77 ms` | **19.21** | 11,908 |

---

### Test 6: Query `"artificial"` (Zero-Match Baseline)
*Measures raw index traversal and parsing latency when no records match, verifying precision.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `73.68 ms` | `95.38 ms` | `85.42 ms` | `136.71 ms` | `147.50 ms` | `147.55 ms` | **10.48** | 0 |
| **PostgreSQL FTS** | `73.28 ms` | `98.10 ms` | `101.59 ms` | `133.34 ms` | `144.07 ms` | `151.09 ms` | **10.19** | 0 |
| **Elasticsearch** | `27.30 ms` | `43.35 ms` | `43.99 ms` | `53.23 ms` | `56.38 ms` | `183.76 ms` | **23.06** | 0 |

---

### Test 7: Query `"kuber"` (Substring / Prefix of "Kubernetes")
*Tests character n-gram partial matching vs word-level tokenization.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `124.07 ms` | `157.12 ms` | `141.59 ms` | `206.79 ms` | `286.86 ms` | `307.21 ms` | **6.36** | **11,908** |
| **PostgreSQL FTS** | `70.44 ms` | `105.83 ms` | `102.26 ms` | `159.00 ms` | `248.76 ms` | `306.85 ms` | **9.45** | **0** |
| **Elasticsearch** | `27.04 ms` | `39.80 ms` | `37.84 ms` | `58.42 ms` | `60.27 ms` | `67.74 ms` | **25.11** | **11,908** |

---

### Test 8: Query `"postgr"` (Substring / Prefix of "PostgreSQL")
*Tests partial code / keyword matching.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `123.90 ms` | `162.03 ms` | `149.66 ms` | `207.58 ms` | `307.30 ms` | `338.58 ms` | **6.17** | **11,927** |
| **PostgreSQL FTS** | `71.77 ms` | `101.66 ms` | `102.58 ms` | `132.83 ms` | `166.27 ms` | `212.94 ms` | **9.84** | **0** |
| **Elasticsearch** | `26.82 ms` | `48.06 ms` | `36.85 ms` | `102.85 ms` | `116.80 ms` | `121.87 ms` | **20.80** | **11,927** |

---

## 🔍 In-Depth Architectural Analysis

```
                              Average Latency Across Query Types
                 ┌────────────────────────────────────────────────────────┐
"database"       │ ILIKE: 142 ms │ FTS: 143 ms │ ES: 43 ms (3.3x faster)  │
"Replication"    │ ILIKE: 474 ms │ FTS: 415 ms │ ES: 50 ms (8.3x faster)  │
"replications"   │ ILIKE: 0 hits │ FTS: 408 ms │ ES: 58 ms (7.1x faster)  │
"kuber" (substr) │ ILIKE: 157 ms │ FTS: 0 hits │ ES: 40 ms (4.0x faster)  │
"artificial" (0) │ ILIKE: 95 ms  │ FTS: 98 ms  │ ES: 43 ms                │
                 └────────────────────────────────────────────────────────┘
```

### 1. 100% Match Recall Parity
In previous iterations, Elasticsearch failed 4 out of 8 queries due to the `standard` analyzer. By deploying the **`english` stemmer** alongside a **3-gram `partial_tokenizer`**:
- **Plurals & Stems:** Queries like `"replications"` and `"container"` match all 23.7k and 11.9k records identically to PostgreSQL FTS.
- **Arbitrary Substrings:** Partial words like `"kuber"` and `"postgr"` match all ~11.9k records identically to PostgreSQL ILIKE (`pg_trgm`).
- **Precision:** Zero-match baseline `"artificial"` returned 0 hits, proving that strict AND matching across n-gram positions avoids false positives.

### 2. Latency Scaling: PostgreSQL Heap Scans vs. Lucene Posting Lists
In PostgreSQL, after the GIN index identifies matching row pointers (`TIDs`), the executor performs a Bitmap Heap Scan to read tuple data and compute `count(*) OVER ()`. When scanning 23,666 rows (nearly a quarter of the table), I/O and CPU overhead multiply:
- **PostgreSQL ILIKE:** `474.05 ms` (2.11 QPS)
- **PostgreSQL FTS:** `414.81 ms` (2.41 QPS)
- **Elasticsearch:** `50.12 ms` (19.95 QPS) — **~8.3x - 9.5x faster** than PostgreSQL under heavy match loads.

### 3. Relevance Ranking with Field Boosting
With `fields: ['searchable_text^3', 'searchable_text.partial']`, exact and stemmed natural language matches are given 3x higher relevance score priority. When users search whole words, exact matches rank highest; when users search incomplete prefixes or substrings, the 3-gram field still delivers accurate, ranked results.

---

## 🏆 Decision Matrix: Choosing the Right Engine

| Criteria | PostgreSQL ILIKE (`pg_trgm`) | PostgreSQL FTS | Elasticsearch (Configured) |
|---|---|---|---|
| **Best For** | Substrings, SKUs, partial words, autocomplete | Natural language documents, articles, descriptions | High-throughput, distributed search combining stems + substrings |
| **Stemming Awareness** | ❌ No (character-only) | ✅ Yes (Snowball English dictionary) | ✅ Yes (`english` analyzer on `searchable_text`) |
| **Substring / Prefix** | ✅ Native character 3-grams | ❌ Whole words only | ✅ Yes (3-gram `partial_tokenizer` subfield) |
| **Relevance Ranking** | ❌ None (`score: null`) | ✅ Built-in `ts_rank` | ✅ Okapi BM25 with `^3` boost |
| **Infrastructure Overhead** | None (in existing DB) | None (in existing DB) | Dedicated JVM cluster or Elastic Cloud |
| **100k Latency (12.5k hits)** | ~142 ms | ~143 ms | ~43 ms |
| **100k Latency (23.7k hits)** | ~474 ms | ~415 ms | ~50 ms |
| **QPS Throughput** | ~2–7 QPS | ~2–7 QPS | ~17–25 QPS |

### Summary Recommendation:
1. **Use PostgreSQL FTS + `pg_trgm`** if your infrastructure is strictly relational, search volume is moderate, and you prefer zero additional operational dependencies.
2. **Use Elasticsearch with English + N-gram Multi-fields** when you need maximum search throughput, sub-60ms response times at scale, and a unified engine that seamlessly handles both natural language grammar and arbitrary partial-word queries.

