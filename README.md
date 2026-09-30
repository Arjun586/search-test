# CSV Search Benchmark

Put one large CSV file in the `data` folder, start Docker, run one command, and
use the dashboard to load, search, and benchmark it.

## Your CSV

Put exactly one `.csv` file directly in `data/`.

```text
data/documents.csv
```

The CSV must have a header row. Its **first column must be a unique document
ID**. Every other column is searchable.

```csv
id,title,content,category
1,PostgreSQL FTS,Search with tsvector,database
2,Elasticsearch,Search with an inverted index,search
```

The application keeps the full row and searches the combined text from all
columns except the first ID column. No document schema is hardcoded.

## Run it

1. Install dependencies once:

   ```powershell
   cd D:\Dev\search-test
   npm install
   ```

2. Start Docker services:

   ```powershell
   docker compose up -d
   ```

3. Start the project:

   ```powershell
   npm run dev
   ```

4. Open [the dashboard](http://localhost:5173).

The API automatically creates its PostgreSQL table, FTS index, and Elasticsearch
index when it starts. There are no migration, setup, or import commands to run.

## Dashboard workflow

1. Click **Load CSV**. This replaces the previously loaded data in both
   PostgreSQL and Elasticsearch.
2. Enter a query and click **Search all** to inspect ILIKE, PostgreSQL FTS, and
   Elasticsearch results side by side.
3. Set the iteration count and click **Run benchmark** to compare average,
   p50/p95/p99 latency, QPS, and result count.

The benchmark uses the same query, 20-result limit, 10 warm-up iterations, and
one concurrent request for all three engines. It displays only values measured
from the loaded CSV.

## What is included

- Docker Compose: PostgreSQL and Elasticsearch
- Streamed, batched CSV import
- PostgreSQL `ILIKE`
- PostgreSQL FTS with `tsvector`, GIN, `websearch_to_tsquery`, and `ts_rank`
- Elasticsearch search
- Dashboard buttons for import, search, and benchmark

Nothing else is required for the workflow above.
