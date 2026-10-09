import { FormEvent, useState } from 'react';

const apiUrl = 'http://localhost:4000';
const engines = ['ilike', 'postgres-fts', 'elasticsearch'] as const;

type Engine = (typeof engines)[number];
type SearchResultItem = {
  id: string;
  document: Record<string, unknown>;
  score: number | null;
};
type SearchResponse = {
  engine: Engine;
  searchLatencyMs: number;
  resultCount: number;
  results: SearchResultItem[];
};
type BenchmarkResultRow = {
  engine: Engine;
  minMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  qps: number;
  resultCount: number;
};
type Benchmark = {
  datasetSize: number;
  query: string;
  results: BenchmarkResultRow[];
};

const label: Record<Engine, string> = {
  ilike: 'PostgreSQL ILIKE',
  'postgres-fts': 'PostgreSQL FTS',
  elasticsearch: 'Elasticsearch',
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Request failed.');
  return data as T;
}

function asMs(value: number) {
  return `${value.toFixed(2)} ms`;
}

export function App() {
  const [message, setMessage] = useState('Put one CSV file in data, then click Load CSV.');
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Partial<Record<Engine, SearchResponse>>>({});
  const [benchmark, setBenchmark] = useState<Benchmark>();
  const [iterations, setIterations] = useState(100);

  const loading = Boolean(loadingAction);

  async function loadCsv() {
    setLoadingAction('loadCsv');
    setMessage('Loading CSV into PostgreSQL and Elasticsearch…');
    try {
      const result = await request<{ fileName: string; documentCount: number; columns: string[] }>('/data/import', { method: 'POST' });
      setSearchResults({});
      setBenchmark(undefined);
      setMessage(`Loaded ${result.documentCount.toLocaleString()} rows from ${result.fileName}. First column is used as the document ID.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'CSV import failed.');
    } finally {
      setLoadingAction(null);
    }
  }

  async function searchSingle(engine: Engine, targetQuery?: string) {
    const q = (targetQuery ?? query).trim();
    if (!q) return;
    setLoadingAction(`search-${engine}`);
    setMessage(`Searching ${label[engine]}…`);
    try {
      const result = await request<SearchResponse>(`/search/${engine}?q=${encodeURIComponent(q)}&limit=5`);
      setSearchResults((prev) => ({ ...prev, [engine]: result }));
      setMessage(`Completed ${label[engine]} in ${asMs(result.searchLatencyMs)} (${result.resultCount.toLocaleString()} matches).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label[engine]} search failed.`);
    } finally {
      setLoadingAction(null);
    }
  }

  async function searchAllSequential(event?: FormEvent) {
    event?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoadingAction('search-all');
    setMessage('Searching engines sequentially (one by one) to prevent database contention…');
    try {
      for (const engine of engines) {
        setMessage(`Searching ${label[engine]} (${engines.indexOf(engine) + 1}/${engines.length})…`);
        const result = await request<SearchResponse>(`/search/${engine}?q=${encodeURIComponent(q)}&limit=5`);
        setSearchResults((prev) => ({ ...prev, [engine]: result }));
      }
      setMessage('All searches completed sequentially.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Search failed.');
    } finally {
      setLoadingAction(null);
    }
  }

  async function runBenchmarkEngine(engine?: Engine) {
    const q = query.trim();
    if (!q) return;
    const actionKey = engine ? `benchmark-${engine}` : 'benchmark-all';
    setLoadingAction(actionKey);
    setMessage(
      engine
        ? `Benchmarking ${label[engine]} (${iterations} iterations)…`
        : `Benchmarking all engines sequentially (${iterations} iterations)…`,
    );
    try {
      const result = await request<Benchmark>('/benchmark', {
        method: 'POST',
        body: JSON.stringify({
          query: q,
          iterations,
          warmupIterations: 10,
          limit: 5,
          engine,
        }),
      });

      setBenchmark((prev) => {
        if (!prev || prev.query !== q || !engine) {
          return result;
        }
        // Merge single engine benchmark into existing result table
        const otherResults = prev.results.filter((r) => r.engine !== engine);
        const merged = [...otherResults, ...result.results].sort(
          (a, b) => engines.indexOf(a.engine) - engines.indexOf(b.engine),
        );
        return { ...result, results: merged };
      });
      setMessage(
        engine
          ? `Benchmark for ${label[engine]} complete.`
          : 'Benchmark complete for all engines.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Benchmark failed.');
    } finally {
      setLoadingAction(null);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-300">Search benchmark</p>
        <h1 className="mt-2 text-3xl font-bold">CSV search lab</h1>
        <p className="mt-2 text-slate-400">Load one CSV, then compare ILIKE, PostgreSQL FTS, and Elasticsearch.</p>
      </header>

      <section className="panel flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold">1. Load CSV data</h2>
          <p className="mt-1 text-sm text-slate-400">The import replaces the currently loaded dataset.</p>
        </div>
        <button className="button" onClick={loadCsv} disabled={loading}>
          {loadingAction === 'loadCsv' ? 'Working…' : 'Load CSV'}
        </button>
      </section>

      <p className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">{message}</p>

      <section className="panel">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">2. Search</h2>
            <p className="mt-1 text-xs text-slate-400">
              Run searches one-by-one or sequentially to prevent PostgreSQL CPU & buffer cache competition.
            </p>
          </div>
        </div>

        <form className="mt-4 flex flex-col gap-3" onSubmit={searchAllSequential}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              className="field flex-1"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Enter a search query (e.g. database, kuber, replication)"
              required
            />
            <button
              type="submit"
              className="button shrink-0"
              disabled={loading || !query.trim()}
            >
              {loadingAction === 'search-all' ? 'Searching…' : 'Search All (Sequential)'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs font-semibold text-slate-400">Run Individual Search:</span>
            {engines.map((engine) => (
              <button
                key={engine}
                type="button"
                className="button-secondary text-xs py-1.5 px-3"
                disabled={loading || !query.trim()}
                onClick={() => searchSingle(engine)}
              >
                {loadingAction === `search-${engine}` ? 'Searching…' : label[engine]}
              </button>
            ))}
          </div>
        </form>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {engines.map((engine) => {
          const result = searchResults[engine];
          const isSearchingThis = loadingAction === `search-${engine}`;
          return (
            <article className="panel flex flex-col min-w-0" key={engine}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{label[engine]}</h3>
                  {isSearchingThis && (
                    <span className="animate-pulse text-xs text-cyan-400 font-medium">Running…</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {result && (
                    <span className="text-xs text-slate-400">
                      {result.resultCount.toLocaleString()} match{result.resultCount === 1 ? '' : 'es'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="button-sm"
                    disabled={loading || !query.trim()}
                    onClick={() => searchSingle(engine)}
                    title={`Run only ${label[engine]}`}
                  >
                    Run
                  </button>
                </div>
              </div>

              {!result && <p className="mt-3 text-sm text-slate-500">No search yet.</p>}

              {result && (
                <>
                  <p className="mt-2 text-lg font-bold text-cyan-300">{asMs(result.searchLatencyMs)}</p>

                  <div className="mt-4 flex-1 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Top 5 Documents</p>
                    {result.results.length === 0 ? (
                      <p className="text-xs text-slate-500">No matching documents found.</p>
                    ) : (
                      result.results.map((doc, idx) => (
                        <div key={doc.id || idx} className="rounded border border-slate-800 bg-slate-950/70 p-2 text-xs">
                          <div className="flex items-center justify-between gap-1 text-slate-400">
                            <span className="truncate font-mono text-cyan-400 max-w-[170px]" title={doc.id}>
                              ID: {doc.id}
                            </span>
                            {doc.score !== null && (
                              <span className="shrink-0 text-slate-500">Score: {Number(doc.score).toFixed(3)}</span>
                            )}
                          </div>
                          {doc.document && Object.keys(doc.document).length > 0 && (
                            <p className="mt-1 line-clamp-2 text-slate-300">
                              {Object.entries(doc.document)
                                .slice(0, 3)
                                .map(([k, v]) => `${k}: ${String(v)}`)
                                .join(' · ')}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </article>
          );
        })}
      </section>

      <section className="panel">
        <div>
          <h2 className="font-semibold">3. Benchmark</h2>
          <p className="mt-1 text-xs text-slate-400">
            Measure latency percentiles & QPS. Run individual engines to isolate Neon and Elasticsearch performance.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label>
              <span className="label">Iterations</span>
              <input
                className="field w-28"
                type="number"
                min="1"
                max="10000"
                value={iterations}
                onChange={(event) => setIterations(Number(event.target.value))}
              />
            </label>

            <button
              type="button"
              className="button"
              disabled={loading || !query.trim()}
              onClick={() => runBenchmarkEngine()}
            >
              {loadingAction === 'benchmark-all' ? 'Benchmarking…' : 'Benchmark All (Sequential)'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
            <span className="text-xs font-semibold text-slate-400">Run Individual Benchmark:</span>
            {engines.map((engine) => (
              <button
                key={engine}
                type="button"
                className="button-secondary text-xs py-1.5 px-3"
                disabled={loading || !query.trim()}
                onClick={() => runBenchmarkEngine(engine)}
              >
                {loadingAction === `benchmark-${engine}` ? 'Running…' : `Benchmark ${label[engine]}`}
              </button>
            ))}
          </div>
        </div>

        {benchmark && (
          <div className="mt-5 overflow-x-auto">
            <p className="mb-3 text-sm text-slate-400">
              {benchmark.datasetSize.toLocaleString()} documents · “{benchmark.query}” · Full scan (5 documents filtered)
            </p>

            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2">Engine</th>
                  <th>Min</th>
                  <th>Average</th>
                  <th>p50</th>
                  <th>p95</th>
                  <th>p99</th>
                  <th>Max</th>
                  <th>QPS</th>
                  <th>Matches</th>
                </tr>
              </thead>

              <tbody>
                {benchmark.results.map((result) => (
                  <tr className="border-b border-slate-800/70" key={result.engine}>
                    <td className="py-3 font-medium">{label[result.engine]}</td>
                    <td>{asMs(result.minMs)}</td>
                    <td>{asMs(result.avgMs)}</td>
                    <td>{asMs(result.p50Ms)}</td>
                    <td>{asMs(result.p95Ms)}</td>
                    <td>{asMs(result.p99Ms)}</td>
                    <td>{asMs(result.maxMs)}</td>
                    <td>{result.qps.toFixed(2)}</td>
                    <td className="text-slate-400">{result.resultCount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

