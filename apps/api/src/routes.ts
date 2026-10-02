import { Router, type Request, type Response } from 'express';
import { limits } from './config.js';
import { searchEngines } from './services/search.js';
import { runBenchmark } from './services/benchmark.js';
import { importCsv } from './services/importer.js';
import type { BenchmarkConfig, SearchEngine } from './types.js';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let importing = false;
let benchmarking = false;

function readSearchInput(request: Request): { query: string; limit: number } {
  const query = typeof request.query.q === 'string' ? request.query.q.trim() : '';
  if (!query) throw new HttpError(400, 'Query parameter "q" is required.');
  if (query.length > limits.queryMaximumLength) {
    throw new HttpError(400, `Query must be at most ${limits.queryMaximumLength} characters.`);
  }

  const rawLimit = request.query.limit;
  if (rawLimit === undefined) return { query, limit: limits.searchLimitDefault };
  if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit)) {
    throw new HttpError(400, 'Limit must be a positive integer.');
  }
  const limit = Number(rawLimit);
  if (limit < 1 || limit > limits.searchLimitMaximum) {
    throw new HttpError(400, `Limit must be between 1 and ${limits.searchLimitMaximum}.`);
  }
  return { query, limit };
}

function integer(value: unknown, fallback: number, maximum: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) {
    throw new HttpError(400, `${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function readBenchmarkConfig(request: Request): BenchmarkConfig {
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

export const routes = Router();

// Data routes
routes.post('/data/import', async (_request, response) => {
  if (importing) throw new HttpError(409, 'A CSV import is already running.');
  importing = true;
  try {
    response.json(await importCsv());
  } finally {
    importing = false;
  }
});

// Search routes
routes.get('/search/:engine', async (request: Request, response: Response): Promise<void> => {
  const engine = request.params.engine as SearchEngine;
  const searchFn = searchEngines[engine];
  if (!searchFn) throw new HttpError(404, `Unknown search engine: ${engine}`);
  const { query, limit } = readSearchInput(request);
  response.json(await searchFn(query, limit));
});

// Benchmark routes
routes.post('/benchmark', async (request, response) => {
  if (benchmarking) throw new HttpError(409, 'A benchmark is already running.');
  benchmarking = true;
  try {
    response.json(await runBenchmark(readBenchmarkConfig(request)));
  } finally {
    benchmarking = false;
  }
});
