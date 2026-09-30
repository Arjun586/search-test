import { rounded } from '../lib/timing.js';
import type { BenchmarkResult } from '../types.js';

function percentile(samples: number[], percent: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * percent) - 1];
}

export function calculateStatistics(samples: number[], totalMs: number, resultCount: number): BenchmarkResult {
  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    minMs: rounded(Math.min(...samples)),
    avgMs: rounded(sum / samples.length),
    p50Ms: rounded(percentile(samples, 0.5)),
    p95Ms: rounded(percentile(samples, 0.95)),
    p99Ms: rounded(percentile(samples, 0.99)),
    maxMs: rounded(Math.max(...samples)),
    qps: rounded(samples.length / (totalMs / 1000)),
    resultCount,
  };
}
