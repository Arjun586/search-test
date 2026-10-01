import { Router, type Request, type Response } from 'express';
import { limits } from '../config.js';
import { HttpError } from '../lib/http-error.js';
import { searchEngines } from '../services/search.js';
import type { SearchEngine } from '../types.js';

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

export const searchRouter = Router();

searchRouter.get('/:engine', async (request: Request, response: Response): Promise<void> => {
  const engine = request.params.engine as SearchEngine;
  const searchFn = searchEngines[engine];
  if (!searchFn) throw new HttpError(404, `Unknown search engine: ${engine}`);
  const { query, limit } = readSearchInput(request);
  response.json(await searchFn(query, limit));
});
