import { FormEvent, useState } from 'react';

const apiUrl = 'http://localhost:4000';
const engines = ['ilike', 'postgres-fts', 'elasticsearch'] as const;

type Engine = (typeof engines)[number];
type SearchResponse = {
  engine: Engine;
  searchLatencyMs: number;
  resultCount: number;
  results: Array<{ id: string; document: Record<string, string>; score: number | null }>;
};
type Benchmark = {
  datasetSize: number;
  query: string;
  results: Array<{
    engine: Engine;
    minMs: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    maxMs: number;
    qps: number;
    resultCount: number;
  }>;
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
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Partial<Record<Engine, SearchResponse>>>({});
  const [benchmark, setBenchmark] = useState<Benchmark>();
  const [iterations, setIterations] = useState(100);

  async function loadCsv() {
    setLoading(true);
    setMessage('Loading CSV into PostgreSQL and Elasticsearch…');
    try {
      const result = await request<{ fileName: string; documentCount: number; columns: string[] }>('/data/import', { method: 'POST' });
      setSearchResults({});
      setBenchmark(undefined);
      setMessage(`Loaded ${result.documentCount.toLocaleString()} rows from ${result.fileName}. First column is used as the document ID.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'CSV import failed.');
    } finally {
      setLoading(false);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setMessage('Searching all three engines…');
    try {
      const results = await Promise.all(engines.map((engine) => request<SearchResponse>(`/search/${engine}?q=${encodeURIComponent(query)}&limit=20`)));
      setSearchResults(Object.fromEntries(results.map((result) => [result.engine, result])));
      setMessage('Search complete.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }

  async function runBenchmark(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setMessage('Running benchmark. This can take a while for a large dataset…');
    try {
      const result = await request<Benchmark>('/benchmark', {
        method: 'POST',
        body: JSON.stringify({ query: query.trim(), iterations, warmupIterations: 10, limit: 20 }),
      });
      setBenchmark(result);
      setMessage('Benchmark complete.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Benchmark failed.');
    } finally {
      setLoading(false);
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
        <div><h2 className="font-semibold">1. Load CSV data</h2><p className="mt-1 text-sm text-slate-400">The import replaces the currently loaded dataset.</p></div>
        <button className="button" onClick={loadCsv} disabled={loading}>{loading ? 'Working…' : 'Load CSV'}</button>
      </section>

      <p className="rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-300">{message}</p>

      <section className="panel">
        <h2 className="font-semibold">2. Search</h2>
        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={search}>
          <input className="field flex-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Enter a search query" required />
          <button className="button" disabled={loading}>{loading ? 'Working…' : 'Search all'}</button>
        </form>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {engines.map((engine) => {
          const result = searchResults[engine];
          return <article className="panel min-w-0" key={engine}>
            <h3 className="font-semibold">{label[engine]}</h3>
            {!result && <p className="mt-3 text-sm text-slate-500">No search yet.</p>}
            {result && <><p className="mt-2 text-sm text-cyan-300">{asMs(result.searchLatencyMs)} · {result.resultCount} results</p><div className="mt-3 space-y-2">{result.results.map((item) => <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs" key={item.id}><div className="flex justify-between gap-2"><span className="font-mono text-cyan-300">{item.id}</span><span className="text-slate-400">{item.score === null ? '' : `score ${item.score.toFixed(3)}`}</span></div><pre className="mt-2 whitespace-pre-wrap break-words text-slate-300">{JSON.stringify(item.document)}</pre></div>)}</div></>}
          </article>;
        })}
      </section>

      <section className="panel">
        <h2 className="font-semibold">3. Benchmark</h2>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={runBenchmark}>
          <label><span className="label">Iterations</span><input className="field w-28" type="number" min="1" max="10000" value={iterations} onChange={(event) => setIterations(Number(event.target.value))} /></label>
          <button className="button" disabled={loading || !query.trim()}>{loading ? 'Working…' : 'Run benchmark'}</button>
        </form>
        {benchmark && <div className="mt-5 overflow-x-auto"><p className="mb-3 text-sm text-slate-400">{benchmark.datasetSize.toLocaleString()} documents · “{benchmark.query}”</p><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-slate-800 text-slate-400"><tr><th className="py-2">Engine</th><th>Min</th><th>Average</th><th>p50</th><th>p95</th><th>p99</th><th>Max</th><th>QPS</th><th>Results</th></tr></thead><tbody>{benchmark.results.map((result) => <tr className="border-b border-slate-800/70" key={result.engine}><td className="py-3">{label[result.engine]}</td><td>{asMs(result.minMs)}</td><td>{asMs(result.avgMs)}</td><td>{asMs(result.p50Ms)}</td><td>{asMs(result.p95Ms)}</td><td>{asMs(result.p99Ms)}</td><td>{asMs(result.maxMs)}</td><td>{result.qps.toFixed(2)}</td><td>{result.resultCount}</td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
