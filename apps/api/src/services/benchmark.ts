import { pool } from '../db.js';
import type { BenchmarkConfig, BenchmarkResult } from '../types.js';
import { searchEngines } from './search.js';

const now = () => performance.now();
const elapsedMs = (start: number) => performance.now() - start;
const rounded = (n: number) => Math.round(n * 1000) / 1000;

function calculateStatistics(samples: number[], totalMs: number, resultCount: number): BenchmarkResult {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const percentile = (p: number) => sorted[Math.ceil(sorted.length * p) - 1];
  return {
    minMs: rounded(sorted[0]),
    avgMs: rounded(sum / sorted.length),
    p50Ms: rounded(percentile(0.5)),
    p95Ms: rounded(percentile(0.95)),
    p99Ms: rounded(percentile(0.99)),
    maxMs: rounded(sorted[sorted.length - 1]),
    qps: rounded(sorted.length / (totalMs / 1000)),
    resultCount,
  };
}

async function benchmarkOne(
  engine: keyof typeof searchEngines,
  config: BenchmarkConfig,
): Promise<BenchmarkResult> {
  const search = searchEngines[engine];

  for (let i = 0; i < config.warmupIterations; i += 1) {
    await search(config.query, config.limit);
  }

  const started = now();
  const timings: number[] = [];
  let resultCount = 0;
  for (let i = 0; i < config.iterations; i += 1) {
    const response = await search(config.query, config.limit);
    timings.push(response.searchLatencyMs);
    resultCount = response.resultCount;
  }
  return calculateStatistics(timings, elapsedMs(started), resultCount);
}

export async function runBenchmark(config: BenchmarkConfig) {
  const count = await pool.query<{ count: string }>('SELECT count(*) FROM documents');
  const results = [];
  for (const engine of Object.keys(searchEngines) as Array<keyof typeof searchEngines>) {
    results.push({ engine, ...(await benchmarkOne(engine, config)) });
  }
  return { datasetSize: Number(count.rows[0].count), query: config.query, results };
}
