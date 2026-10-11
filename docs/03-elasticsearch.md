# Strategy 3: Elasticsearch

## 💡 What is it?
**Elasticsearch** is a dedicated distributed search and analytics engine built on Apache Lucene. Unlike PostgreSQL, where search is a secondary feature layered on top of a relational database, Elasticsearch was architected from the ground up to provide high-speed full-text search, term scoring, and horizontal scalability across millions of documents.

---

## ⚙️ How does it work?

### 1. The Lucene Inverted Index
Instead of storing rows and scanning them, Elasticsearch builds a **Lucene inverted index**. For every term that appears in any document, it creates a lookup entry pointing to the list of document IDs (and term frequencies):

```
Term            Posting List (Document IDs & Frequencies)
─────────────────────────────────────────────────────────
"databas"    ──► [ Doc 2 (tf: 2), Doc 16 (tf: 1), Doc 28 (tf: 3) ... ]
"kub"        ──► [ Doc 8 (tf: 1), Doc 15 (tf: 2) ... ]
"replic"     ──► [ Doc 1 (tf: 2), Doc 2 (tf: 1) ... ]
```
When searching for `"database"`, Elasticsearch directly inspects the posting list in memory. Counting total hits (`track_total_hits: true`) and scoring top documents is performed directly against index structures without touching the underlying raw document storage.

### 2. Relevance Scoring (Okapi BM25)
Elasticsearch scores documents using the **BM25 algorithm**, which evaluates:
- **Term Frequency (TF):** How often the query term appears in this document.
- **Inverse Document Frequency (IDF):** How rare the term is across the entire corpus (rare words score higher than frequent words).
- **Field-Length Normalization:** Shorter fields where the term constitutes a higher proportion of the text are boosted over longer fields.

### 3. Dual Architecture: English Stemmer + Positional Trigram Subfield
To achieve **both** linguistic stemming (matching plurals/tenses) and arbitrary substring matching (prefixes, partial words) without false positives:
- **`searchable_text` (`english` analyzer):**
  - Uses Unicode tokenization, lowercasing, and English Snowball/Porter stemming.
  - Reduces `"replications"` and `"replication"` to `"replic"`.
  - Reduces `"containers"` and `"container"` to `"contain"`.
  - Boosted with `^3` at query time so exact and stemmed words take top relevance priority.
- **`searchable_text.partial` (`partial_tokenizer`):**
  - An `ngram` tokenizer generating continuous 3-character slices (`min_gram: 3, max_gram: 3`).
  - Matches arbitrary prefixes and substrings (e.g. `"kuber"` ➔ `"kubernetes"`, `"postgr"` ➔ `"postgresql"`).
  - Maintains strict `AND` matching across all trigrams, preventing false positives.

---

## 🛠️ How this project uses it

### 1. Index Setup & Mapping (`setup.ts`)
```typescript
const elasticsearchIndexConfig = {
  settings: {
    analysis: {
      tokenizer: {
        partial_tokenizer: {
          type: 'ngram',
          min_gram: 3,
          max_gram: 3,
          token_chars: ['letter', 'digit'],
        },
      },
      analyzer: {
        partial_analyzer: {
          type: 'custom',
          tokenizer: 'partial_tokenizer',
          filter: ['lowercase'],
        },
      },
    },
  },
  mappings: {
    dynamic: true,
    properties: {
      id: { type: 'keyword' },
      document: { type: 'object', dynamic: true },
      searchable_text: {
        type: 'text',
        analyzer: 'english',
        fields: {
          partial: {
            type: 'text',
            analyzer: 'partial_analyzer',
          },
        },
      },
    },
  },
} as const;
```

### 2. Search Query Execution (`services/search.ts`)
```typescript
await elasticsearch.search<IndexedDocument>({
  index: config.elasticsearchIndex,
  size: limit, // default: 5
  track_total_hits: true,
  query: {
    multi_match: {
      query,
      fields: ['searchable_text^3', 'searchable_text.partial'],
      operator: 'and',
    },
  },
});
```

> ⚠️ **Why `track_total_hits: true` matters:**  
> By default, Elasticsearch caps its total hit calculation at 10,000 documents for maximum speed. In this benchmark lab, `track_total_hits: true` is enabled to force Elasticsearch to compute the exact total matching count across all 100,000 documents, matching the behavior of PostgreSQL's `count(*) OVER ()`.

---

## 📊 Actual Benchmark Performance (Truthful Lab Results)

Evaluated over 100,000 documents across 100 sequential benchmark iterations:

| Scenario / Query | Type | Avg Latency | p50 | p95 | p99 | QPS | Matches |
|---|---|---|---|---|---|---|---|
| **`database`** (Test 1) | Common word | `42.97 ms` | `42.57 ms` | `59.88 ms` | `82.24 ms` | **23.25** | **12,511** |
| **`Replication`** (Test 2) | High-frequency (~24% corpus) | `50.12 ms` | `43.88 ms` | `90.76 ms` | `102.34 ms` | **19.95** | **23,666** |
| **`replications`** (Test 3) | Plural variant (stemmed) | `57.69 ms` | `47.95 ms` | `102.83 ms` | `117.00 ms` | **17.33** | **23,666** |
| **`container`** (Test 4) | Singular query (stemmed) | `48.12 ms` | `40.12 ms` | `87.23 ms` | `109.58 ms` | **20.77** | **11,908** |
| **`containers`** (Test 5) | Plural query (exact token match) | `52.04 ms` | `40.76 ms` | `102.69 ms` | `117.94 ms` | **19.21** | **11,908** |
| **`artificial`** (Test 6) | Zero-match baseline | `43.35 ms` | `43.99 ms` | `53.23 ms` | `56.38 ms` | **23.06** | **0** |
| **`kuber`** (Test 7) | Substring / prefix of "Kubernetes" | `39.80 ms` | `37.84 ms` | `58.42 ms` | `60.27 ms` | **25.11** | **11,908** |
| **`postgr`** (Test 8) | Substring / prefix of "PostgreSQL" | `48.06 ms` | `36.85 ms` | `102.85 ms` | `116.80 ms` | **20.80** | **11,927** |

---

## 🔍 Key Behavioral Insights

### 1. 100% Match Parity Across All Search Scenarios
With the dual `english` stemmer and `partial_analyzer` (3-gram tokenizer):
- **Stemming (Tests 1, 3, 4, 5):** Elasticsearch now captures all 12,511 database matches (including plural tags), matches `"replications"` to `"replication"` (23,666 docs), and matches `"container"` to `"containers"` (11,908 docs).
- **Substrings (Tests 7 & 8):** Partial words like `"kuber"` and `"postgr"` match all ~11.9k docs with sub-50ms latency.
- **Precision (Test 6):** `"artificial"` returned exactly 0 matches, confirming that the positional 3-gram tokenizer does not produce false positives.

### 2. Unmatched Latency Stability Under Heavy Match Load
Notice the difference between Test 1 (12.5k matches) and Test 2 (23.7k matches):
- **PostgreSQL:** Latency surged from ~142 ms to **414–474 ms**.
- **Elasticsearch:** Latency remained rock-solid at **50.12 ms** (p50: 43.88 ms, 19.95 QPS).  
Because Lucene evaluates matching doc IDs in optimized bitsets and term postings in memory, counting 23,666 hits incurred virtually no additional overhead. At high match volume, Elasticsearch is **~8.3x - 9.5x faster than PostgreSQL**.

### 3. Relevance Ranking with Term Weighting
Because `searchable_text^3` applies a 3x boost to the stemmed whole-word field, exact and linguistic root matches always rank above partial substring matches, giving users ideal relevance ordering while still supporting typeahead/substring discovery.

---

## ⚖️ Pros and Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Blazing fast latency (39–57 ms) across all scenarios | High operational footprint (requires dedicated JVM processes or Elastic Cloud) |
| BM25 scoring with field boosting (`^3`) for relevance | Additional storage overhead from indexing both stems and character 3-grams |
| Complete coverage: stems natural language AND matches arbitrary substrings | Requires real-time data sync pipeline between primary database and Elasticsearch |
| Horizontally scalable across clusters and shards | |
| Offloads search I/O entirely from the primary relational database | |

---

## 🎯 When to use Elasticsearch
- **High-Traffic Search Applications:** Where search volume would saturate relational database CPU and buffer pools.
- **Large Document Corpora:** Where queries frequently match tens of thousands of rows and PostgreSQL latency drops into hundreds of milliseconds.
- **Unified Linguistic & Substring Search:** Where you need the natural language stemming of FTS and the substring flexibility of `pg_trgm` in a single, high-throughput engine.

