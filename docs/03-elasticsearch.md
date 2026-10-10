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
"database"   ──► [ Doc 2 (tf: 2), Doc 16 (tf: 1), Doc 28 (tf: 3) ... ]
"kubernetes" ──► [ Doc 8 (tf: 1), Doc 15 (tf: 2) ... ]
"replication"──► [ Doc 1 (tf: 2), Doc 2 (tf: 1) ... ]
```
When searching for `"database"`, Elasticsearch directly inspects the posting list in memory. Counting total hits (`track_total_hits: true`) and scoring top documents is performed directly against index structures without touching the underlying raw document storage.

### 2. Relevance Scoring (Okapi BM25)
Elasticsearch scores documents using the **BM25 algorithm**, which evaluates:
- **Term Frequency (TF):** How often the query term appears in this document.
- **Inverse Document Frequency (IDF):** How rare the term is across the entire corpus (rare words score higher than frequent words).
- **Field-Length Normalization:** Shorter fields where the term constitutes a higher proportion of the text are boosted over longer fields.

### 3. The `standard` Analyzer
In this project's setup (`setup.ts`), `searchable_text` uses Elasticsearch's built-in `standard` analyzer:
- **Tokenization:** Breaks text on word boundaries (Unicode Text Segmentation).
- **Lowercasing:** Converts all tokens to lowercase.
- **Punctuation Removal:** Strips symbols and punctuation.
- ⚠️ **No Stemming:** Unlike PostgreSQL's `'english'` dictionary, the `standard` analyzer does **not** stem words (e.g. `"databases"` remains `"databases"`; it is not reduced to `"database"`).

---

## 🛠️ How this project uses it

### 1. Index Setup & Mapping (`setup.ts`)
```typescript
await elasticsearch.indices.create({
  index: config.elasticsearchIndex, // Defaults to 'search_documents'
  mappings: {
    dynamic: true,
    properties: {
      id: { type: 'keyword' },
      document: { type: 'object', dynamic: true },
      searchable_text: { type: 'text', analyzer: 'standard' },
    },
  },
});
```

### 2. Search Query Execution (`services/search.ts`)
```typescript
await elasticsearch.search({
  index: config.elasticsearchIndex,
  size: limit, // default: 5
  track_total_hits: true,
  query: {
    multi_match: {
      query: userQuery,
      fields: ['searchable_text'],
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
| **`database`** (Test 1) | Common word | `46.18 ms` | `43.44 ms` | `79.35 ms` | `90.63 ms` | **21.64** | 11,912* |
| **`replication`** (Test 2) | High-frequency (~24% corpus) | `42.35 ms` | `36.04 ms` | `62.26 ms` | `67.13 ms` | **23.59** | 23,666 |
| **`replications`** (Test 3) | Plural variant (no stemming) | `34.11 ms` | `31.29 ms` | `52.63 ms` | `56.51 ms` | **29.31** | **0** |
| **`container`** (Test 4) | Singular query (plural in corpus) | `40.50 ms` | `36.77 ms` | `56.21 ms` | `59.93 ms` | **24.68** | **0** |
| **`containers`** (Test 5) | Plural query (exact token match) | `50.65 ms` | `52.50 ms` | `69.49 ms` | `84.95 ms` | **19.74** | **11,908** |
| **`artificial`** (Test 6) | Zero-match baseline | `37.51 ms` | `34.41 ms` | `53.10 ms` | `55.11 ms` | **26.66** | 0 |
| **`kuber`** (Test 7) | Substring / prefix of "Kubernetes" | `37.80 ms` | `34.98 ms` | `51.09 ms` | `54.26 ms` | **26.45** | **0** |
| **`postgr`** (Test 8) | Substring / prefix of "PostgreSQL" | `34.39 ms` | `33.97 ms` | `38.59 ms` | `41.71 ms` | **29.07** | **0** |

*\*The 599 missing matches on "database" (11,912 vs 12,511 in Postgres) occurred because 599 articles contained only the plural form "Databases" in categories/tags, which the `standard` analyzer does not stem.*

---

## 🔍 Key Behavioral Insights

### 1. Unmatched Latency Stability Under Heavy Match Load (Test 2)
Notice the difference between Test 1 (12.5k matches) and Test 2 (23.7k matches):
- **PostgreSQL:** Latency surged from 134 ms to **412–464 ms**.
- **Elasticsearch:** Latency remained at **42.35 ms** (p50: 36.04 ms, 23.59 QPS).  
Because Lucene evaluates matching doc IDs in optimized bitsets and term postings in memory, counting 23,666 hits incurred virtually no additional overhead. At high match volume, Elasticsearch is **~10x faster than PostgreSQL**.

### 2. The `standard` Analyzer Pitfall (Tests 3 & 4)
Because the `standard` analyzer does not perform stemming:
- Searching `"replications"` found **0 matches** (the data only contained `"replication"`).
- Searching `"container"` found **0 matches** (the data only contained `"containers"`).  
When the query was switched to `"containers"` in Test 5, Elasticsearch immediately matched all **11,908 documents**, proving that the failure was entirely linguistic.

### 3. No Substring or Prefix Matching by Default (Tests 7 & 8)
Searching partial words like `"kuber"` or `"postgr"` returned **0 matches**. The standard analyzer tokenizes `"Kubernetes"` as a whole word; it cannot find `"kuber"` inside it unless an `edge_ngram` filter, wildcard query, or prefix query is explicitly configured.

---

## ⚖️ Pros and Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Blazing fast and rock-solid latency (34–50 ms) regardless of match count | High operational footprint (requires dedicated JVM processes and infrastructure) |
| BM25 scoring tailored for search relevance out of the box | Default `standard` analyzer misses word stems and plurals (`replications` ➔ 0 matches) |
| Horizontally scalable across clusters and shards | Cannot match arbitrary substrings without custom `ngram` analyzers |
| Offloads search I/O entirely from the primary relational database | Requires real-time data sync pipeline between database and Elasticsearch |

---

## 🎯 When to use Elasticsearch
- **High-Traffic Search Applications:** Where search volume would saturate relational database CPU and buffer pools.
- **Large Document Corpora:** Where queries frequently match tens of thousands of rows and PostgreSQL latency drops into hundreds of milliseconds.
- **Advanced Search Features:** Where you need faceted search, aggregations, typo tolerance (fuzzy matching), and custom language analyzers.

> 💡 **Production Tip:** To fix the stemming and substring limitations observed in tests 3, 4, 7, and 8, production Elasticsearch mappings typically configure an `'english'` analyzer (for Snowball stemming) alongside a sub-field with an `edge_ngram` filter (for substring typeahead).
