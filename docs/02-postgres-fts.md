# Strategy 2: PostgreSQL Full-Text Search (FTS)

## 💡 What is it?
While trigrams operate on raw character n-grams, **PostgreSQL Full-Text Search (FTS)** is an integrated linguistic search engine. It understands natural language morphology, stripping suffixes to find root words, removing noise words, and ranking matching documents by relevance.

FTS provides search-engine capabilities directly inside relational PostgreSQL tables without requiring an external service like Elasticsearch or Solr.

---

## ⚙️ How does it work?

### 1. Document Parsing & Tokenization (`to_tsvector`)
PostgreSQL takes input text and transforms it into a normalized sorted list of distinct lexemes:
- **Stop Word Removal:** Common grammatical filler words (`"the"`, `"is"`, `"at"`, `"and"`) are discarded.
- **Linguistic Stemming:** The default `'english'` dictionary uses the **Snowball stemmer** to reduce words to their base root:
  - `"replication"`, `"replications"`, and `"replicating"` ➔ `'replic'`
  - `"container"` and `"containers"` ➔ `'contain'`
  - `"database"` and `"databases"` ➔ `'databas'`
- **Positional Weighting:** Each lexeme stores its word position within the document for proximity calculation and ranking.

```
Input Text: "Understanding replication and containers in databases"
       │
       ▼ (Remove stop words: "and", "in")
       ▼ (Snowball stemming: "replication" -> 'replic', "containers" -> 'contain', "databases" -> 'databas')
       │
Stored TSVECTOR: 'contain':4 'databas':6 'replic':2 'understand':1
```

### 2. Query Parsing (`websearch_to_tsquery`)
User queries are converted to boolean `tsquery` trees:
- `websearch_to_tsquery('english', 'database')` parses natural user input into `'databas'`.
- Supports quoted phrases (`"distributed systems"`), exclusions (`-legacy`), and boolean `OR`.

### 3. Relevance Ranking (`ts_rank`)
PostgreSQL scores how closely each document matches the query using term frequency and density:
```sql
ts_rank(d.search_vector, q.value) AS score
```
Top documents receive float scores (e.g., `0.091`), allowing deterministic sorting by best match (`ORDER BY score DESC`).

---

## 🛠️ How this project uses it

### 1. Generated Column & GIN Index (`setup.ts`)
```sql
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  document JSONB NOT NULL,
  searchable_text TEXT NOT NULL,
  -- Stored generated column automatically synchronizes tsvector with text
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(searchable_text, ''))
  ) STORED
);

-- Fast GIN index over the normalized lexemes
CREATE INDEX IF NOT EXISTS documents_search_vector_idx
  ON documents USING GIN (search_vector);
```

### 2. Search Query Execution (`services/search.ts`)
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

> ⚠️ **Why `count(*) OVER ()` matters:**  
> The window function calculates the true total match count across all 100,000 documents for pagination. Ranking with `ts_rank` and sorting `ORDER BY score DESC LIMIT 5` requires PostgreSQL to score matching documents, while `count(*) OVER ()` records the full result count without a separate `SELECT count(*)` query.

---

## 📊 Actual Benchmark Performance (Truthful Lab Results)

Evaluated over 100,000 documents across 100 sequential benchmark iterations:

| Scenario / Query | Type | Avg Latency | p50 | p95 | p99 | QPS | Matches |
|---|---|---|---|---|---|---|---|
| **`database`** (Test 1) | Common word | `133.80 ms` | `127.83 ms` | `151.60 ms` | `155.84 ms` | **7.47** | 12,511 |
| **`replication`** (Test 2) | High-frequency (~24% corpus) | `412.87 ms` | `404.91 ms` | `466.14 ms` | `609.95 ms` | **2.42** | 23,666 |
| **`replications`** (Test 3) | Plural variant (stemmed) | `396.26 ms` | `388.09 ms` | `434.93 ms` | `526.24 ms` | **2.52** | **23,666** |
| **`container`** (Test 4) | Singular query (stemmed) | `159.34 ms` | `153.67 ms` | `189.15 ms` | `219.14 ms` | **6.28** | **11,908** |
| **`containers`** (Test 5) | Plural query (stemmed) | `159.14 ms` | `149.60 ms` | `185.36 ms` | `380.79 ms` | **6.28** | **11,908** |
| **`artificial`** (Test 6) | Zero-match baseline | `80.11 ms` | `75.74 ms` | `100.85 ms` | `107.67 ms` | **12.48** | 0 |
| **`kuber`** (Test 7) | Prefix / Substring (unstemmed) | `87.53 ms` | `81.52 ms` | `122.36 ms` | `153.53 ms` | **11.42** | **0** |
| **`postgr`** (Test 8) | Prefix / Substring (unstemmed) | `72.98 ms` | `71.67 ms` | `76.82 ms` | `91.50 ms` | **13.70** | **0** |

---

## 🔍 Key Behavioral Insights

### 1. The Linguistic Stemming Triumph (Tests 3 & 4)
The benchmark demonstrated the immense power of morphological stemming:
- When searching for `"replications"`, the dataset only contained the singular word `"replication"`. Both ILIKE (no stemming) and Elasticsearch (`standard` analyzer) returned **0 matches**. PostgreSQL FTS reduced `"replications"` to `'replic'` and successfully found all **23,666 documents**!
- Similarly, searching `"container"` matched all **11,908 documents** whose tags were `"containers"`, whereas Elasticsearch returned **0 matches**.

### 2. Relevance Scoring (`ts_rank`)
Unlike ILIKE, which returns results in arbitrary table heap order, FTS scores each row. For `"database"`, top documents were returned with scores such as `0.091`, ensuring the most relevant articles appear first.

### 3. Inability to Match Substrings & Prefixes (Tests 7 & 8)
FTS is strictly token-based. Querying `"kuber"` or `"postgr"` yielded **0 matches** because `"kuber"` is not an English word and does not stem to `'kubernet'`. For partial-word matching, FTS requires either prefix operators (`kuber:*` in raw `tsquery`) or a hybrid combination with `pg_trgm`.

### 4. Heavy Match Latency at High Scale (Test 2)
When a search term matches 23.7% of the entire table (`"replication"`), scoring and counting 23,666 rows via GIN took **412.87 ms** average. While ~11% faster than ILIKE (464.17 ms), it is ~10x slower than Elasticsearch (42.35 ms).

---

## ⚖️ Pros and Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Natural language stemming out of the box (handles plurals, tenses, suffixes) | Cannot match partial substrings (e.g., `kuber` misses `Kubernetes`) |
| Relevance scoring via `ts_rank` to order best matches first | Language-specific (requires appropriate dictionary like `'english'`) |
| Integrated into PostgreSQL with generated columns (no sync pipelines) | Latency increases significantly on common terms with full counts (~412 ms) |
| Native support for boolean logic, phrase queries, and stop words | Slower than dedicated inverted index engines (Elasticsearch) at scale |

---

## 🎯 When to use PostgreSQL Full-Text Search (FTS)
- **Document & Article Search:** Where grammatical forms (e.g. searching "deploy" should match "deployed" or "deploying") must be resolved seamlessly.
- **Ranked Results:** Where users expect relevance-ranked results rather than boolean substring filtering.
- **All-in-One Database Architecture:** When you want advanced natural language search without deploying, synchronizing, and operating an external Elasticsearch cluster.
