import { Router, type Request } from 'express';
import { limits } from '../config.js';
import { HttpError } from '../lib/http-error.js';
import { runBenchmark } from '../services/benchmark.js';
import type { BenchmarkConfig } from '../types.js';

let benchmarking = false;

function integer(value: unknown, fallback: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new HttpError(400, `${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function readConfig(request: Request): BenchmarkConfig {
  const body = (request.body ?? {}) as Record<string, unknown>;
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query || query.length > limits.queryMaximumLength) {
    throw new HttpError(400, `query is required and must be at most ${limits.queryMaximumLength} characters.`);
  }
  return {
    query,
    iterations: integer(body.iterations, 100, limits.benchmarkIterationsMaximum, 'iterations'),
    warmupIterations: integer(body.warmupIterations, 10, limits.benchmarkWarmupMaximum, 'warmupIterations'),
    limit: integer(body.limit, limits.searchLimitDefault, limits.searchLimitMaximum, 'limit'),
  };
}

export const benchmarkRouter = Router();

benchmarkRouter.post('/', async (request, response) => {
  if (benchmarking) throw new HttpError(409, 'A benchmark is already running.');
  benchmarking = true;
  try {
    response.json(await runBenchmark(readConfig(request)));
  } finally {
    benchmarking = false;
  }
});
