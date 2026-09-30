import { pool } from '../db.js';
import { elapsedMs, now } from '../lib/timing.js';
import type { BenchmarkConfig, BenchmarkResult, SearchEngine, SearchResponse } from '../types.js';
import { searchWithElasticsearch } from './elasticsearch-search.js';
import { searchWithIlike } from './ilike-search.js';
import { searchWithPostgresFts } from './postgres-fts.js';
import { calculateStatistics } from './statistics.js';

type SearchImplementation = {
  engine: SearchEngine;
  search: (query: string, limit: number) => Promise<SearchResponse>;
};

const implementations: SearchImplementation[] = [
  { engine: 'ilike', search: searchWithIlike },
  { engine: 'postgres-fts', search: searchWithPostgresFts },
  { engine: 'elasticsearch', search: searchWithElasticsearch },
];

async function benchmarkOne(
  implementation: SearchImplementation,
  config: BenchmarkConfig,
): Promise<BenchmarkResult> {
  for (let i = 0; i < config.warmupIterations; i += 1) {
    await implementation.search(config.query, config.limit);
  }

  const started = now();
  const timings: number[] = [];
  let resultCount = 0;
  for (let i = 0; i < config.iterations; i += 1) {
    const response = await implementation.search(config.query, config.limit);
    timings.push(response.searchLatencyMs);
    resultCount = response.resultCount;
  }
  return calculateStatistics(timings, elapsedMs(started), resultCount);
}

export async function runBenchmark(config: BenchmarkConfig) {
  const count = await pool.query<{ count: string }>('SELECT count(*) FROM documents');
  const results = [];
  for (const implementation of implementations) {
    results.push({ engine: implementation.engine, ...(await benchmarkOne(implementation, config)) });
  }
  return { datasetSize: Number(count.rows[0].count), query: config.query, results };
}
