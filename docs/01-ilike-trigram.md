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
| **`database`** (Test 1) | Common word | `136.12 ms` | `129.89 ms` | `164.45 ms` | `198.31 ms` | **7.34** | 12,511 |
| **`replication`** (Test 2) | High-frequency (~24% corpus) | `464.17 ms` | `454.97 ms` | `512.77 ms` | `542.43 ms` | **2.15** | 23,666 |
| **`replications`** (Test 3) | Plural variant (no stemming) | `197.14 ms` | `190.75 ms` | `213.66 ms` | `363.08 ms` | **5.07** | **0** |
| **`container`** (Test 4) | Substring of plural "containers" | `147.10 ms` | `140.86 ms` | `167.14 ms` | `193.28 ms` | **6.80** | **11,908** |
| **`artificial`** (Test 6) | Zero-match baseline | `81.91 ms` | `76.34 ms` | `104.65 ms` | `121.57 ms` | **12.21** | 0 |
| **`kuber`** (Test 7) | Prefix of "Kubernetes" | `142.03 ms` | `137.86 ms` | `164.75 ms` | `183.18 ms` | **7.04** | **11,908** |
| **`postgr`** (Test 8) | Prefix of "PostgreSQL" | `130.23 ms` | `126.14 ms` | `142.89 ms` | `177.32 ms` | **7.68** | **11,927** |

---

## 🔍 Key Behavioral Insights

### 1. The Substring Superpower (Tests 7 & 8)
Trigrams do not care about word boundaries, dictionary lexemes, or whitespace. Searching `"kuber"` or `"postgr"` matched ~11,900 documents in ~130–142 ms because the trigrams (`kub`, `ube`, `ber`) existed within `"Kubernetes"` and `"PostgreSQL"`. Both PostgreSQL Full-Text Search and Elasticsearch failed completely on these queries (**0 matches**).

### 2. Performance Parity on Common Words (Test 1)
Previous documentation claimed ILIKE took ~558 ms on `"database"`. In actual benchmark testing, **ILIKE averaged 136.12 ms**, matching PostgreSQL FTS (133.80 ms) almost identically.

### 3. Degradation Under Extreme Match Volume (Test 2)
When a term matches nearly a quarter of the entire corpus (`"replication"`: 23,666 of 100,000 rows), PostgreSQL must merge massive trigram posting lists and compute `count(*) OVER ()` across 23,666 rows. Average latency jumped to **464.17 ms** (QPS dropped to 2.15).

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
