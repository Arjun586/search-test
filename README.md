# CSV Search Benchmark Lab

A hands-on benchmarking lab to evaluate, test, and compare three production search strategies over the same CSV dataset under identical application conditions.

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

- **End-to-End Latency:** Measures application-observed round-trip time (`Dashboard → Node.js API → Database / Search Engine → Dashboard`).
- **Corpus-Wide Matching:** Calculates total matching documents across the entire corpus (`count(*) OVER ()` in PostgreSQL, `track_total_hits: true` in Elasticsearch) alongside top-5 document retrieval.
- **Sequential Evaluation:** Runs queries sequentially to benchmark baseline execution latency and throughput under controlled iterations.

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

