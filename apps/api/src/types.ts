export type SearchEngine = 'ilike' | 'postgres-fts' | 'elasticsearch';

export type SearchResult = {
  id: string;
  document: Record<string, unknown>;
  score: number | null;
};

export type SearchResponse = {
  engine: SearchEngine;
  query: string;
  searchLatencyMs: number;
  resultCount: number;
  results: SearchResult[];
};

export type BenchmarkConfig = {
  query: string;
  iterations: number;
  warmupIterations: number;
  limit: number;
};

export type BenchmarkResult = {
  minMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  qps: number;
  resultCount: number;
};

