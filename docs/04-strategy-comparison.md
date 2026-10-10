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
      "fields": ["searchable_text"],
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

Below are the exact metrics recorded across the 8 test runs stored in the `result/` directory:

### Test 1: Query `"database"` (Common Word — 12.5% of Corpus)
*Tests common single-word lookup and plural category tokenization.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `124.89 ms` | `136.12 ms` | `129.89 ms` | `164.45 ms` | `198.31 ms` | `290.73 ms` | **7.34** | 12,511 |
| **PostgreSQL FTS** | `121.38 ms` | `133.80 ms` | `127.83 ms` | `151.60 ms` | `155.84 ms` | `205.74 ms` | **7.47** | 12,511 |
| **Elasticsearch** | `31.67 ms` | `46.18 ms` | `43.44 ms` | `79.35 ms` | `90.63 ms` | `97.29 ms` | **21.64** | 11,912* |

*\*Elasticsearch missed 599 articles containing only "Databases" in categories/tags because the `standard` analyzer does not perform stemming.*

---

### Test 2: Query `"replication"` (High-Frequency Term — 23.7% of Corpus)
*Tests engine scaling when matches encompass nearly a quarter of the entire dataset.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `427.04 ms` | `464.17 ms` | `454.97 ms` | `512.77 ms` | `542.43 ms` | `736.77 ms` | **2.15** | 23,666 |
| **PostgreSQL FTS** | `368.97 ms` | `412.87 ms` | `404.91 ms` | `466.14 ms` | `609.95 ms` | `633.79 ms` | **2.42** | 23,666 |
| **Elasticsearch** | `31.95 ms` | `42.35 ms` | `36.04 ms` | `62.26 ms` | `67.13 ms` | `67.44 ms` | **23.59** | 23,666 |

---

### Test 3: Query `"replications"` (Plural Variant — Stemming Test)
*Tests whether engines recognize plural queries when the dataset only contains singular forms.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `184.00 ms` | `197.14 ms` | `190.75 ms` | `213.66 ms` | `363.08 ms` | `411.14 ms` | **5.07** | **0** |
| **PostgreSQL FTS** | `367.47 ms` | `396.26 ms` | `388.09 ms` | `434.93 ms` | `526.24 ms` | `594.53 ms` | **2.52** | **23,666** |
| **Elasticsearch** | `29.86 ms` | `34.11 ms` | `31.29 ms` | `52.63 ms` | `56.51 ms` | `56.87 ms` | **29.31** | **0** |

---

### Test 4: Query `"container"` (Singular Query — Dataset Contains Plural "containers")
*Tests singular-to-plural match behavior.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `131.80 ms` | `147.10 ms` | `140.86 ms` | `167.14 ms` | `193.28 ms` | `265.61 ms` | **6.80** | **11,908** |
| **PostgreSQL FTS** | `141.73 ms` | `159.34 ms` | `153.67 ms` | `189.15 ms` | `219.14 ms` | `227.58 ms` | **6.28** | **11,908** |
| **Elasticsearch** | `30.75 ms` | `40.50 ms` | `36.77 ms` | `56.21 ms` | `59.93 ms` | `63.40 ms` | **24.68** | **0** |

---

### Test 5: Query `"containers"` (Plural Query Matching Plural Data)
*Validates that Elasticsearch's Test 4 failure was purely due to missing analyzer stemming.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `129.18 ms` | `149.59 ms` | `141.49 ms` | `177.90 ms` | `280.87 ms` | `390.01 ms` | **6.68** | 11,908 |
| **PostgreSQL FTS** | `139.32 ms` | `159.14 ms` | `149.60 ms` | `185.36 ms` | `380.79 ms` | `384.79 ms` | **6.28** | 11,908 |
| **Elasticsearch** | `31.25 ms` | `50.65 ms` | `52.50 ms` | `69.49 ms` | `84.95 ms` | `91.63 ms` | **19.74** | 11,908 |

---

### Test 6: Query `"artificial"` (Zero-Match Baseline)
*Measures raw index traversal and parsing latency when no records match.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `71.09 ms` | `81.91 ms` | `76.34 ms` | `104.65 ms` | `121.57 ms` | `121.84 ms` | **12.21** | 0 |
| **PostgreSQL FTS** | `70.64 ms` | `80.11 ms` | `75.74 ms` | `100.85 ms` | `107.67 ms` | `111.60 ms` | **12.48** | 0 |
| **Elasticsearch** | `30.55 ms` | `37.51 ms` | `34.41 ms` | `53.10 ms` | `55.11 ms` | `57.88 ms` | **26.66** | 0 |

---

### Test 7: Query `"kuber"` (Substring / Prefix of "Kubernetes")
*Tests character n-gram partial matching vs word-level tokenization.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `127.00 ms` | `142.03 ms` | `137.86 ms` | `164.75 ms` | `183.18 ms` | `200.94 ms` | **7.04** | **11,908** |
| **PostgreSQL FTS** | `73.56 ms` | `87.53 ms` | `81.52 ms` | `122.36 ms` | `153.53 ms` | `208.81 ms` | **11.42** | **0** |
| **Elasticsearch** | `30.56 ms` | `37.80 ms` | `34.98 ms` | `51.09 ms` | `54.26 ms` | `54.66 ms` | **26.45** | **0** |

---

### Test 8: Query `"postgr"` (Substring / Prefix of "PostgreSQL")
*Tests partial code / keyword matching.*

| Engine | Min | Average | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|
| **PostgreSQL ILIKE** | `121.20 ms` | `130.23 ms` | `126.14 ms` | `142.89 ms` | `177.32 ms` | `323.13 ms` | **7.68** | **11,927** |
| **PostgreSQL FTS** | `70.14 ms` | `72.98 ms` | `71.67 ms` | `76.82 ms` | `91.50 ms` | `97.26 ms` | **13.70** | **0** |
| **Elasticsearch** | `30.12 ms` | `34.39 ms` | `33.97 ms` | `38.59 ms` | `41.71 ms` | `64.69 ms` | **29.07** | **0** |

---

## 🔍 In-Depth Architectural Analysis

```
                              Average Latency Across Query Types
                 ┌────────────────────────────────────────────────────────┐
"database"       │ ILIKE: 136 ms │ FTS: 134 ms │ ES: 46 ms                │
"replication"    │ ILIKE: 464 ms │ FTS: 413 ms │ ES: 42 ms (10x faster)   │
"replications"   │ ILIKE: 0 hits │ FTS: 396 ms (23.6k hits) │ ES: 0 hits │
"kuber" (substr) │ ILIKE: 142 ms (11.9k hits) │ FTS: 0 hits │ ES: 0 hits │
"artificial" (0) │ ILIKE: 82 ms  │ FTS: 80 ms  │ ES: 38 ms                │
                 └────────────────────────────────────────────────────────┘
```

### 1. Latency Scaling: PostgreSQL Heap Visits vs. Lucene Inverted Indexes
Across the benchmark tests, PostgreSQL latency correlates directly with the number of matched documents:
- **0 matches:** ~70–80 ms
- **~11.9k matches:** ~130–160 ms
- **~23.7k matches:** ~410–464 ms

**Why?** In PostgreSQL, after the GIN index identifies matching row pointers (`TIDs`), the executor performs a Bitmap Heap Scan to read tuple data and compute `count(*) OVER ()`. When scanning 23,666 rows (nearly a quarter of the table), I/O and CPU overhead multiply.

**Why Elasticsearch Remains Flat (34–50 ms):** Elasticsearch maintains term dictionaries and posting lists in memory with Roaring Bitmaps. Evaluating `track_total_hits: true` and returning top-5 documents requires no heap scans. It processed 23,666 hits in **42.35 ms** — over **10x faster than PostgreSQL**.

### 2. The Stemming Divide: PostgreSQL FTS Triumph (Test 3)
The most striking linguistic divergence occurred on `"replications"`:
- The technical articles in `data.csv` frequently discuss `"replication"`, but never the plural `"replications"`.
- **ILIKE** looked for literal character sequence `%replications%` ➔ **0 matches**.
- **Elasticsearch** (with `standard` analyzer) looked for exact token `"replications"` ➔ **0 matches**.
- **PostgreSQL FTS** passed `"replications"` through the Snowball English stemmer, reducing it to the root lexeme `'replic'`. Because `"replication"` also reduces to `'replic'`, FTS instantly matched **all 23,666 documents**.

### 3. The Substring Divide: PostgreSQL ILIKE Triumph (Tests 7 & 8)
When users search by typing incomplete prefixes or substrings:
- Searching `"kuber"` (for Kubernetes) or `"postgr"` (for PostgreSQL) yielded **0 matches in FTS and Elasticsearch**.
- **PostgreSQL ILIKE (`pg_trgm`)** broke the query into character trigrams (`kub`, `ube`, `ber`) and matched **11,908 and 11,927 documents** respectively in ~130–142 ms.
- For autocomplete, SKU search, code snippets, or partial terms, trigram indexing provides capabilities that whole-token analyzers cannot match without custom n-gram configurations.

### 4. Real-World Speed Difference: Clarifying Misconceptions
Previous documentation claimed Elasticsearch was "69x faster than ILIKE" and "15x faster than FTS".
- In reality, for typical single-word queries like `"database"`, Elasticsearch is **~2.9x faster** (46.18 ms vs 133–136 ms).
- PostgreSQL ILIKE and PostgreSQL FTS run with **almost identical latency** on standard single terms (136 ms vs 134 ms).
- Elasticsearch only achieves a **10x speed advantage** when queries match very large slices of the corpus (>20,000 documents) where PostgreSQL's window count and heap access overhead compound.

---

## 🏆 Decision Matrix: Choosing the Right Engine

| Criteria | PostgreSQL ILIKE (`pg_trgm`) | PostgreSQL FTS | Elasticsearch |
|---|---|---|---|
| **Best For** | Substrings, SKUs, partial words, autocomplete | Natural language documents, articles, descriptions | Dedicated search engines, huge datasets, multi-tenant scale |
| **Stemming Awareness** | ❌ No (character-only) | ✅ Yes (Snowball English dictionary) | ⚠️ Requires `'english'` analyzer (not default `standard`) |
| **Substring / Prefix** | ✅ Native character 3-grams | ❌ Whole words only | ❌ Requires custom `edge_ngram` index |
| **Relevance Ranking** | ❌ None (`score: null`) | ✅ Built-in `ts_rank` | ✅ Okapi BM25 |
| **Infrastructure Overhead** | None (in existing DB) | None (in existing DB) | Dedicated JVM cluster, syncing pipelines |
| **100k Latency (12.5k hits)** | ~136 ms | ~134 ms | ~46 ms |
| **100k Latency (23.7k hits)** | ~464 ms | ~413 ms | ~42 ms |
| **QPS Throughput** | ~2–7 QPS | ~2–7 QPS | ~20–30 QPS |

### Summary Recommendation:
1. **Stick with PostgreSQL FTS** if your documents are natural language text, you need relevance ranking and stemming, and your dataset is within hundreds of thousands of rows.
2. **Add `pg_trgm`** alongside FTS if your application features autocomplete, partial-code lookups, or user-facing prefix search.
3. **Graduate to Elasticsearch** when your dataset reaches millions of documents, search volume begins impacting primary database OLTP transactions, or you require sub-50ms latency on massive result sets.
