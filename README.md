# CSV Search Benchmark Lab

A hands-on benchmarking lab to evaluate, test, and compare three production search strategies over the same CSV dataset under identical application conditions.

---

## ⚡ Benchmark Results at a Glance

> ⚠️ **Important Context: This is One Query for One Common Word**  
> Every benchmark number in this table represents a **single query for one common word: `"database"`**, which matches **12,511 of the 100,000 documents (~12.5% of the entire corpus)** with a full window count on top (`count(*) OVER ()` in PostgreSQL, `track_total_hits: true` in Elasticsearch).  
> **Do not interpret "ILIKE: ~558 ms" as ILIKE's general speed.** Trigrams are fast for selective, rare terms (e.g. SKUs, emails, rare names). Because `"database"` appears in over 12,500 documents, PostgreSQL must scan and intersect massive trigram inverted lists and compute window counts across 12,511 rows. On selective queries, ILIKE is significantly faster.

| Strategy | Engine | Min | Avg | p50 | p95 | p99 | Max | QPS | Matches |
|---|---|---|---|---|---|---|---|---|---|
| [**ILIKE (`pg_trgm`)**](docs/01-ilike-trigram.md) | PostgreSQL 16 | `540.48 ms` | `557.98 ms` | `550.45 ms` | `598.45 ms` | `645.93 ms` | `664.93 ms` | **1.79** | 12,511 |
| [**Full-Text Search (FTS)**](docs/02-postgres-fts.md) | PostgreSQL 16 | `92.43 ms` | `121.02 ms` | `116.74 ms` | `150.22 ms` | `168.33 ms` | `176.17 ms` | **8.26** | 12,511 |
| [**Elasticsearch**](docs/03-elasticsearch.md) | Elasticsearch 8.19.0 | `5.60 ms` | `8.09 ms` | `7.60 ms` | `9.53 ms` | `14.97 ms` | `46.16 ms` | **123.35** | 11,912* |

*\*Why 11,912 vs 12,511? Elasticsearch's `standard` analyzer does not stem words, missing 599 documents that only contain the plural "Databases", while PostgreSQL's English stemmer and ILIKE matched both forms (see [doc 04](docs/04-strategy-comparison.md)).*

### ⚙️ Benchmark Environment & Setup
- **Hardware:** 12th Gen Intel Core i5-12450H (8 cores / 12 threads), 16 GB RAM, Windows 11.
- **Docker Setup:** PostgreSQL 16 Alpine, Elasticsearch 8.19.0 (single-node, `ES_JAVA_OPTS: -Xms512m -Xmx512m`).
- **Dataset:** 100,000 technical articles from CSV (~91 MB; `id`, `title`, `summary`, `content`, `tags`, `author`, `category` concatenated into `searchable_text`).
- **Local Testing Fluctuations:** In local testing environments, benchmark numbers **can fluctuate** due to background OS tasks, CPU thermal throttling, Docker virtualization overhead, and memory/disk cache warming. These numbers reflect a stable, warmed run (100 sequential iterations).

---

## 🔍 Search Strategies Tested

| Strategy | Engine | Core Mechanism | Primary Use Case |
|---|---|---|---|
| [**ILIKE (`pg_trgm`)**](docs/01-ilike-trigram.md) | PostgreSQL | Trigram GIN index matching character n-grams | Substring and partial character matching |
| [**Full-Text Search (FTS)**](docs/02-postgres-fts.md) | PostgreSQL | Lexical `tsvector` + `tsquery` + GIN index with `ts_rank` | Word-level stemming and relevance ranking inside Postgres |
| [**Elasticsearch**](docs/03-elasticsearch.md) | Elasticsearch | Lucene inverted index with standard text analysis | Dedicated search workloads, rich analyzers, and distributed scale |

> 📖 *For beginner-friendly deep dives into each strategy and the full benchmark breakdown, see [`docs/`](docs/) or read the [**Search Strategy Comparison & Benchmark Analysis**](docs/04-strategy-comparison.md).*

---

## 🏗️ Architecture

```
                 CSV Dataset (data/*.csv)
                            │
                      Batch Importer
                     (500 rows/batch)
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
       PostgreSQL                     Elasticsearch
   ┌─────────────────┐             ┌─────────────────┐
   │ pg_trgm (GIN)   │             │ Lucene Inverted │
   │ tsvector (GIN)  │             │ Index (standard)│
   └────────┬────────┘             └────────┬────────┘
            └───────────────┬───────────────┘
                            ▼
                    Express API (:4000)
                            │
                            ▼
                  React Dashboard (:5173)
```

---

## ⚡ Quickstart

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Docker & Docker Compose](https://www.docker.com/)

### 1. Place your CSV data
Add exactly one `.csv` file directly into the `data/` directory (e.g. `data/data.csv`):
- **First column:** Unique document ID.
- **Subsequent columns:** Combined automatically into `searchable_text`.

### 2. Start PostgreSQL & Elasticsearch
```bash
docker compose up -d
```

### 3. Install dependencies & start dev servers
```bash
npm install
npm run dev
```

- **Dashboard:** [http://localhost:5173](http://localhost:5173)
- **API Server:** [http://localhost:4000](http://localhost:4000)

*Note: Database schemas, extensions (`pg_trgm`), and Elasticsearch indexes are automatically provisioned when the API starts.*

---

## 🖥️ Dashboard Workflow

1. **Load CSV**: Imports and indexes the CSV file into both PostgreSQL and Elasticsearch in batches.
2. **Search All**: Runs queries across all three engines concurrently to inspect top-5 filtered results, relevance scores, total match counts, and end-to-end latency.
3. **Run Benchmark**: Executes sequential runs (with warm-up passes) over a configured iteration count to produce latency percentiles (**min, avg, p50, p95, p99, max**) and **QPS**.

---

## 📊 Benchmark Characteristics

- **One Common Word Query:** All benchmark metrics are based on a single query for the common word `"database"`, matching **12,511 of 100,000 documents (~12.5% of the dataset)**. This high result volume exercises the engine's inverted list merging and heap fetching. On selective queries (e.g. unique codes or names), ILIKE is significantly faster.
- **Corpus-Wide Matching & Pagination:** Queries measure true pagination overhead by calculating total matching documents across the entire corpus (`count(*) OVER ()` in PostgreSQL, `track_total_hits: true` in Elasticsearch) alongside top-5 document retrieval.
- **End-to-End Latency:** Measures application-observed round-trip time (`Dashboard → Node.js API → Database / Search Engine → Dashboard`).
- **Sequential Evaluation:** Runs queries sequentially to benchmark baseline execution latency and throughput under controlled iterations.
- **Local Testing Fluctuations:** Numbers recorded on local developer machines can fluctuate based on CPU thermal throttling, OS background processes, Docker desktop virtualization, and cache state. These numbers illustrate relative orders of magnitude rather than absolute production SLAs.

---

## 📁 Project Structure

```
├── apps/
│   ├── api/            # Express backend (TypeScript, pg, @elastic/elasticsearch)
│   │   └── src/
│   │       ├── services/   # Search engines, batch importer, benchmark runner
│   │       ├── db.ts       # Database & Elasticsearch client connections
│   │       └── setup.ts    # Auto-migration for schema & indexes
│   └── dashboard/      # Frontend UI (React 19, Vite, Tailwind CSS)
├── data/               # Target directory for the source CSV file
├── docs/               # Strategy guides and deep-dives (ILIKE, FTS, Elasticsearch)
├── docker-compose.yml  # PostgreSQL 16 & Elasticsearch 8.19 containers
└── package.json        # Workspace scripts & dependencies
```

---

## 🛠️ Tech Stack

- **Backend:** Node.js, Express, TypeScript
- **Databases:** PostgreSQL 16 (`pg_trgm`, `tsvector`, GIN), Elasticsearch 8.19
- **Frontend:** React 19, Vite, Tailwind CSS
- **Infrastructure:** Docker Compose

