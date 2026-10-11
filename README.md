# CSV Search Benchmark Lab

A hands-on benchmarking lab to evaluate, test, and compare three production search strategies over the same 100,000-document CSV dataset under identical application conditions: **PostgreSQL ILIKE (`pg_trgm`)**, **PostgreSQL Full-Text Search (FTS)**, and **Elasticsearch**.

---

## ⚡ Benchmark Results at a Glance

All benchmark numbers below are taken directly from actual, truthful benchmark runs executed against a **100,000-document technical article dataset** (~91 MB CSV). Benchmarks measure end-to-end application round-trip latency (`React Dashboard ➔ Express API ➔ Database / Search Engine ➔ React Dashboard`) over **100 sequential iterations** (post 10-iteration warm-up), evaluating full corpus match counts (`count(*) OVER ()` in PostgreSQL, `track_total_hits: true` in Elasticsearch) alongside top-5 document retrieval.

### Primary Benchmark: `"database"` (100k Documents, 100 Iterations)

| Strategy | Engine | Min | Avg | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|---|
| [**ILIKE (`pg_trgm`)**](docs/01-ilike-trigram.md) | PostgreSQL 16 | `125.33 ms` | `141.84 ms` | `132.77 ms` | `174.11 ms` | `204.91 ms` | `345.42 ms` | **7.05** | 12,511 |
| [**Full-Text Search (FTS)**](docs/02-postgres-fts.md) | PostgreSQL 16 | `123.06 ms` | `142.57 ms` | `135.76 ms` | `196.03 ms` | `208.05 ms` | `212.47 ms` | **7.01** | 12,511 |
| [**Elasticsearch**](docs/03-elasticsearch.md) | Elasticsearch 8.19.0 | `30.41 ms` | `42.97 ms` | `42.57 ms` | `59.88 ms` | `82.24 ms` | `84.30 ms` | **23.25** | **12,511** |

*Elasticsearch achieves 100% match parity with PostgreSQL via the `'english'` analyzer, matching both singular and plural document tags while completing queries **~3.3x faster** than PostgreSQL.*

---

## 📊 Comprehensive 8-Query Benchmark Suite (Actual Test Results)

Evaluating a single query does not reveal the true trade-offs between character trigrams, natural language lexemes, and Lucene inverted indexes. Below is the complete matrix from 8 distinct benchmark scenarios tested in the lab (`result/database.png`, `result/Replication.png`, `result/replications.png`, `result/container.png`, `result/containers.png`, `result/artificial.png`, `result/kuber.png`, `result/postgr.png`):

| Test | Query | Type / Scenario Tested | ILIKE Avg (QPS) | FTS Avg (QPS) | Elasticsearch Avg (QPS) | Matches (ILIKE / FTS / ES) | Key Finding |
|---|---|---|---|---|---|---|---|
| **Test 1** | `database` | Common word (12.5% corpus) | 141.84 ms (7.05) | 142.57 ms (7.01) | 42.97 ms (23.25) | 12,511 / 12,511 / 12,511 | 100% parity across all engines; ES is **3.3x faster**. |
| **Test 2** | `Replication` | High-frequency term (23.7% corpus) | 474.05 ms (2.11) | 414.81 ms (2.41) | 50.12 ms (19.95) | 23,666 / 23,666 / 23,666 | At 23.7k matches, PostgreSQL GIN list merging slows down; ES is **~8.3x - 9.5x faster**. |
| **Test 3** | `replications` | Plural search (singular in corpus) | 210.58 ms (4.75) | 408.26 ms (2.45) | 57.69 ms (17.33) | 0 / 23,666 / 23,666 | **Stemming Triumph**: FTS & ES both stem `'replic'`. ES is **7.1x faster** than FTS. ILIKE fails (0). |
| **Test 4** | `container` | Singular search (plural in corpus) | 164.87 ms (6.07) | 169.19 ms (5.91) | 48.12 ms (20.77) | 11,908 / 11,908 / 11,908 | ILIKE matches substring; FTS & ES stem word. ES is **3.5x faster**. |
| **Test 5** | `containers` | Plural search matching plural data | 159.66 ms (6.26) | 177.21 ms (5.64) | 52.04 ms (19.21) | 11,908 / 11,908 / 11,908 | Exact plural match across all engines; ES is **3.4x faster**. |
| **Test 6** | `artificial` | Zero-match term (not in corpus) | 95.38 ms (10.48) | 98.10 ms (10.19) | 43.35 ms (23.06) | 0 / 0 / 0 | Clean zero-match baseline across all engines (no false positives). |
| **Test 7** | `kuber` | Partial word / prefix of "Kubernetes" | 157.12 ms (6.36) | 105.83 ms (9.45) | 39.80 ms (25.11) | 11,908 / 0 / 11,908 | ILIKE & ES 3-gram match partial prefix. FTS fails (0). ES is **4.0x faster** than ILIKE. |
| **Test 8** | `postgr` | Partial word / prefix of "PostgreSQL" | 162.03 ms (6.17) | 101.66 ms (9.84) | 48.06 ms (20.80) | 11,927 / 0 / 11,927 | ILIKE & ES 3-gram match partial prefix. FTS fails (0). ES is **3.4x faster** than ILIKE. |

> 📖 *For complete percentiles (min, avg, p50, p95, p99, max), query execution plans, and architectural analysis, see [**docs/04-strategy-comparison.md**](docs/04-strategy-comparison.md).*

---

## 🔍 Search Strategies Tested

| Strategy | Engine | Core Mechanism | Match Behavior | Primary Use Case |
|---|---|---|---|---|
| [**ILIKE (`pg_trgm`)**](docs/01-ilike-trigram.md) | PostgreSQL | GIN index over character 3-grams (`gin_trgm_ops`) | Arbitrary substring and character chunks | Partial words, SKUs, usernames, emails, autocomplete |
| [**Full-Text Search (FTS)**](docs/02-postgres-fts.md) | PostgreSQL | `tsvector` generated column + English Snowball stemmer + GIN index + `ts_rank` | Linguistic stems & lexemes | Natural language document search inside PostgreSQL |
| [**Elasticsearch**](docs/03-elasticsearch.md) | Elasticsearch | Lucene Inverted Index (`english` analyzer + 3-gram `partial_tokenizer`) + BM25 | Stems AND arbitrary character substrings | High-throughput, distributed search with low-latency scale and complete linguistic + partial-word coverage |

---

## 🏗️ Architecture

```
                       Source CSV Dataset (data/*.csv)
                                     │
                               Batch Importer
                             (500 rows / batch)
                                     │
            ┌────────────────────────┴────────────────────────┐
            ▼                                                 ▼
      PostgreSQL                                        Elasticsearch
 ┌────────────────────────────────────────┐       ┌────────────────────────────────┐
 │ Table: documents                       │       │ Index: search_documents        │
 │ - id (TEXT PRIMARY KEY)                │       │ - id (keyword)                 │
 │ - document (JSONB)                     │       │ - document (object)            │
 │ - searchable_text (TEXT)               │       │ - searchable_text (text)       │
 │   └─ GIN Index: gin_trgm_ops           │       │    ├─ Analyzer: english        │
 │ - search_vector (TSVECTOR STORED)      │       │    └─ Subfield: partial (ngram)│
 │   └─ GIN Index: search_vector_idx      │       └───────────────┬────────────────┘
 └───────────────────┬────────────────────┘                       │
                     └──────────────────────┬─────────────────────┘
                                            ▼
                                   Express API (:4000)
                              ┌───────────────────────────┐
                              │ GET  /health              │
                              │ POST /data/import         │
                              │ GET  /search/:engine      │
                              │ POST /benchmark           │
                              └─────────────┬─────────────┘
                                            ▼
                                 React Dashboard (:5173)
                                 (Sequential Search & UI)
```

---

## ⚡ Quickstart

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Docker & Docker Compose](https://www.docker.com/) (or existing PostgreSQL and Elasticsearch instances)

### 1. Place your CSV data
Place a single `.csv` file into the `data/` directory (e.g., `data/data.csv`):
- **First column:** Unique document identifier (mapped to `id`).
- **Remaining columns:** Concatenated automatically into `searchable_text`.
- The included dataset contains 100,000 articles across `id`, `title`, `summary`, `content`, `tags`, `author`, `category`.

### 2. Configure Environment & Start Services
The project supports both local Docker containers and cloud-managed services (like Neon PostgreSQL and Elastic Cloud):

**Option A: Local Docker (default)**
```bash
docker compose up -d
```
*Starts PostgreSQL 16 on port 5432 and Elasticsearch 8.19.0 on port 9200.*

**Option B: Managed Cloud Services**
Update `.env` in the project root:
```env
PORT=4000
CORS_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require
PG_SSL=true
ELASTICSEARCH_URL=https://your-cluster.elastic.cloud:443
ELASTICSEARCH_API_KEY=your_api_key
ELASTICSEARCH_INDEX=search_documents
```

### 3. Install dependencies & start dev servers
```bash
npm install
npm run dev
```

- **Dashboard:** [http://localhost:5173](http://localhost:5173)
- **API Server:** [http://localhost:4000](http://localhost:4000)

*Note: Database extensions (`pg_trgm`), tables, generated tsvectors, GIN indexes, and the Elasticsearch index are automatically initialized when the API starts.*

---

## 🖥️ Dashboard Workflow

1. **Load CSV Data**:
   - Truncates existing PostgreSQL documents and recreates the Elasticsearch index.
   - Streams the CSV in chunks of 500 records, building JSONB representations, concatenated text fields, and Elasticsearch bulk operations.
2. **Search**:
   - **Search All (Sequential)**: Executes searches across all three engines one-by-one to prevent PostgreSQL CPU and buffer cache contention.
   - **Run Individual Search**: Executes against a single engine (`PostgreSQL ILIKE`, `PostgreSQL FTS`, or `Elasticsearch`) on demand.
   - Displays top 5 matching documents, document attributes, relevance score (where applicable), total matches, and end-to-end latency.
3. **Benchmark**:
   - **Benchmark All (Sequential)**: Sequentially executes 100 benchmark iterations per engine (preceded by 10 warm-up runs).
   - **Run Individual Benchmark**: Runs a dedicated benchmark on a single selected engine to isolate performance.
   - Computes **min, avg, p50, p95, p99, max, QPS**, and corpus match count.

---

## 🔬 Benchmark Methodology & Key Findings

1. **Why Full Window Counts (`count(*) OVER ()` & `track_total_hits: true`) Matter:**  
   In real search interfaces with pagination (e.g. "Showing 1–5 of 23,666 results"), the application must determine the total matching records.
   - If queries only fetched `LIMIT 5` without a total count, PostgreSQL could stop scanning after the first 5 heap matches (early exit), masking real pagination costs.
   - By calculating `count(*) OVER ()` in PostgreSQL and setting `track_total_hits: true` in Elasticsearch, the benchmark evaluates the true cost of full result set resolution.
2. **PostgreSQL Latency Scales with Match Volume:**  
   - For 0 matches (`artificial`), PostgreSQL takes **~80 ms**.
   - For 12.5k matches (`database`), PostgreSQL takes **~134–136 ms**.
   - For 23.7k matches (`replication`), PostgreSQL takes **~412–464 ms**.  
   PostgreSQL GIN indexes must fetch and intersect posting lists and resolve table heap rows.
3. **Elasticsearch Maintains Consistent Low Latency:**  
   - Across all 8 tests, Elasticsearch stayed between **34 ms and 50 ms** average latency (20–29 QPS), regardless of whether matches were 0, 11.9k, or 23.6k documents.
4. **The Stemming & Tokenization Trade-Off:**  
   - PostgreSQL FTS uses an English Snowball stemmer by default. Searching `"replications"` matched 23,666 rows because both `"replication"` and `"replications"` reduce to the root stem `'replic'`.
   - Elasticsearch configured with the `standard` analyzer does not stem, returning **0 matches** for `"replications"` and `"container"`.
5. **The Substring Power of `pg_trgm`:**  
   - Searching partial words like `"kuber"` or `"postgr"` matched ~11.9k records in ILIKE, while returning **0 matches** in FTS and Elasticsearch.
6. **Understanding Latency Percentiles & Metrics (One-Line Definitions):**  
   - **p0 (Min):** Fastest single search request observed across all benchmark iterations.
   - **p10:** 10% of requests completed within this time (optimal warmed-cache baseline).
   - **p50 (Median):** Typical user experience under steady state (50% faster, 50% slower).
   - **p90:** 90% of requests completed within this time (threshold before tail latency).
   - **p95:** 95% of requests completed within this time (standard industry SLA target).
   - **p99:** 99% of requests completed within this time (tail latency during I/O or GC spikes).
   - **p99.9:** 99.9% of requests completed within this time (extreme 1-in-1,000 outlier latency).
   - **p100 (Max):** Single slowest response recorded across the entire benchmark run.
   - **Average (Mean):** Total duration of all requests divided by the iteration count.
   - **QPS:** Sequential queries processed per second (`iterations / total_time_in_seconds`).

---

## 📁 Project Structure

```
├── apps/
│   ├── api/                 # Express backend (TypeScript, pg, @elastic/elasticsearch)
│   │   └── src/
│   │       ├── config.ts    # Port, database URLs, limits, index configuration
│   │       ├── db.ts        # pg Pool & Elasticsearch Client setup
│   │       ├── routes.ts    # /health, /data/import, /search/:engine, /benchmark
│   │       ├── server.ts    # Express initialization and service readiness checks
│   │       ├── setup.ts     # Schema migrations, GIN indexes, ES index creation
│   │       ├── types.ts     # Search, benchmark, and engine type definitions
│   │       └── services/
│   │           ├── importer.ts   # Streaming CSV parser with 500-row batching
│   │           ├── search.ts     # ILIKE, FTS, and Elasticsearch search queries
│   │           └── benchmark.ts  # Benchmark engine, percentiles, and QPS calculator
│   └── dashboard/           # Frontend UI (React 19, Vite, Tailwind CSS)
│       └── src/
│           ├── App.tsx      # Interactive search and benchmark dashboard
│           ├── main.tsx     # React root mount
│           └── styles.css   # Custom styles & design system utilities
├── data/                    # Directory for CSV dataset (data/data.csv)
├── docs/                    # In-depth strategy documentation
│   ├── 01-ilike-trigram.md       # PostgreSQL ILIKE pg_trgm guide
│   ├── 02-postgres-fts.md        # PostgreSQL Full-Text Search guide
│   ├── 03-elasticsearch.md       # Elasticsearch guide & standard analyzer analysis
│   └── 04-strategy-comparison.md # Master 8-test comparison & benchmark breakdown
├── result/                  # Benchmark screenshots (test 1.png through test 8.png)
├── docker-compose.yml       # Local PostgreSQL 16 & Elasticsearch 8.19 containers
└── package.json             # Workspace dependencies and scripts
```

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express 5, TypeScript 5.9, `pg` 8.16, `@elastic/elasticsearch` 8.19, `csv-parse`
- **Databases:** PostgreSQL 16 (`pg_trgm`, `tsvector`, GIN indexes), Elasticsearch 8.19
- **Frontend:** React 19, Vite 7, Tailwind CSS 3.4
- **Infrastructure:** Docker Compose (local), Neon PostgreSQL & Elastic Cloud (cloud-ready)
