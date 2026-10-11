# Strategy 1: PostgreSQL ILIKE with Trigrams (`pg_trgm`)

## 💡 What is it?
Standard SQL `LIKE '%query%'` or `ILIKE '%query%'` performs a full sequential table scan: PostgreSQL must inspect every row in the table one by one. On a 100,000-row table, an unindexed scan is prohibitively slow for real-time user requests.

**PostgreSQL Trigram Search (`pg_trgm`)** enables indexing for substring searches. By breaking text into 3-character slices (trigrams) and storing them in an inverted index (GIN), PostgreSQL can jump directly to rows containing those character sequences without scanning the entire table.

---

## ⚙️ How does it work?

### 1. Breaking text into Trigrams (3-letter chunks)
PostgreSQL pads text with spaces and slices it into continuous sequences of 3 characters:
- The word `"apple"` generates:
  - `"  a"`, `" ap"`, `"app"`, `"ppl"`, `"ple"`, `"le "`
- When searching with `ILIKE '%ppl%'`, PostgreSQL extracts the trigram `"ppl"` from the query.

### 2. GIN Index Lookup (`gin_trgm_ops`)
A **Generalized Inverted Index (GIN)** maps each trigram to the list of document IDs (posting lists) where it occurs:
```
Query: "ppl"
       │
       ▼
[ GIN Trigram Index ] ──► Found in Doc #1 ("apple"), Doc #14 ("application")
       │
       ▼
Bitmap Heap Scan retrieves matching rows from table storage
```
For longer queries (e.g. `"database"`: `dat`, `ata`, `tab`, `aba`, `bas`, `ase`), PostgreSQL retrieves the posting lists for each trigram and intersects them to find candidate rows containing all trigrams.

---

## 🛠️ How this project uses it

### 1. Extension & Schema Migration (`setup.ts`)
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL,
  searchable_text TEXT NOT NULL,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(searchable_text, ''))
  ) STORED
);

-- GIN Trigram index over the combined text
CREATE INDEX IF NOT EXISTS documents_searchable_text_trgm_idx
  ON documents USING GIN (searchable_text gin_trgm_ops);
```

### 2. Search Query Execution (`services/search.ts`)
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

> ⚠️ **Why `count(*) OVER ()` matters:**  
> Real-world paginated search UIs require both the current page of results (e.g. top 5) and the total count of matching records across the entire dataset (e.g. "Showing 1–5 of 12,511 matches"). The window function `count(*) OVER ()` forces PostgreSQL to count every matching row across the entire 100,000-document table. Without `count(*) OVER ()`, a simple `LIMIT 5` would allow PostgreSQL to terminate immediately upon finding 5 rows (early exit), masking real pagination latency.

---

## 📊 Actual Benchmark Performance (Truthful Lab Results)

Evaluated over 100,000 documents across 100 sequential benchmark iterations:

| Scenario / Query | Type | Avg Latency | p50 | p95 | p99 | QPS | Matches |
|---|---|---|---|---|---|---|---|
| **`database`** (Test 1) | Common word | `141.84 ms` | `132.77 ms` | `174.11 ms` | `204.91 ms` | **7.05** | 12,511 |
| **`Replication`** (Test 2) | High-frequency (~24% corpus) | `474.05 ms` | `461.76 ms` | `534.47 ms` | `651.82 ms` | **2.11** | 23,666 |
| **`replications`** (Test 3) | Plural variant (no stemming) | `210.58 ms` | `204.50 ms` | `265.75 ms` | `355.92 ms` | **4.75** | **0** |
| **`container`** (Test 4) | Substring of plural "containers" | `164.87 ms` | `152.58 ms` | `205.51 ms` | `328.77 ms` | **6.07** | **11,908** |
| **`containers`** (Test 5) | Plural query (exact token) | `159.66 ms` | `148.01 ms` | `206.68 ms` | `224.49 ms` | **6.26** | **11,908** |
| **`artificial`** (Test 6) | Zero-match baseline | `95.38 ms` | `85.42 ms` | `136.71 ms` | `147.50 ms` | **10.48** | 0 |
| **`kuber`** (Test 7) | Prefix of "Kubernetes" | `157.12 ms` | `141.59 ms` | `206.79 ms` | `286.86 ms` | **6.36** | **11,908** |
| **`postgr`** (Test 8) | Prefix of "PostgreSQL" | `162.03 ms` | `149.66 ms` | `207.58 ms` | `307.30 ms` | **6.17** | **11,927** |

---

## 🔍 Key Behavioral Insights

### 1. The Substring Superpower (Tests 7 & 8)
Trigrams do not care about word boundaries, dictionary lexemes, or whitespace. Searching `"kuber"` or `"postgr"` matched ~11,900 documents in ~157–162 ms because the trigrams (`kub`, `ube`, `ber`) existed within `"Kubernetes"` and `"PostgreSQL"`. In comparison, whole-word dictionary engines like PostgreSQL Full-Text Search return **0 matches** on these queries.

### 2. Performance Parity on Common Words (Test 1)
In actual benchmark testing, **ILIKE averaged 141.84 ms**, matching PostgreSQL FTS (142.57 ms) almost identically.

### 3. Degradation Under Extreme Match Volume (Test 2)
When a term matches nearly a quarter of the entire corpus (`"Replication"`: 23,666 of 100,000 rows), PostgreSQL must merge massive trigram posting lists and compute `count(*) OVER ()` across 23,666 rows. Average latency jumped to **474.05 ms** (QPS dropped to 2.11).

### 4. No Stemming or Grammar Awareness (Test 3)
ILIKE is strictly character-based. Searching `"replications"` returned **0 matches** because the documents contained only the singular `"replication"`. Because `"replications"` is longer than `"replication"`, it cannot match as a substring.

### 5. No Relevance Ranking
Unlike FTS (which scores with `ts_rank`) and Elasticsearch (which scores with BM25), ILIKE provides boolean matching: a row either matches or does not. Rows are returned in storage order without relevance scoring (`score: null`).

---

## ⚖️ Pros and Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Matches arbitrary substrings, partial words, prefixes, and suffixes | No relevance ranking (`score: null`, cannot sort by best match) |
| Case-insensitive out of the box | No grammatical stemming (cannot equate "replications" with "replication") |
| Finds SKUs, emails, usernames, code identifiers without custom analyzers | GIN index size can be substantial on large text corpora |
| Zero external infrastructure (runs entirely inside PostgreSQL) | High latency (~464 ms) when terms match a high percentage of rows with total counts |

---

## 🎯 When to use PostgreSQL ILIKE (`pg_trgm`)
- **Autocomplete & Typeahead:** Where users type incomplete words like `"kuber"` and expect `"Kubernetes"` to appear.
- **Identifiers & Codes:** Searching product SKUs, serial codes, email addresses, or usernames.
- **Substring Filtering:** Where users need `contains` semantics directly inside existing relational queries without maintaining external search engines.
