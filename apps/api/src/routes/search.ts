import { Router, type Request, type Response } from 'express';
import { limits } from '../config.js';
import { HttpError } from '../lib/http-error.js';
import { searchWithElasticsearch } from '../services/elasticsearch-search.js';
import { searchWithIlike } from '../services/ilike-search.js';
import { searchWithPostgresFts } from '../services/postgres-fts.js';
import type { SearchResponse } from '../types.js';

type SearchFunction = (query: string, limit: number) => Promise<SearchResponse>;

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

function handler(search: SearchFunction) {
  return async (request: Request, response: Response): Promise<void> => {
    const { query, limit } = readSearchInput(request);
    response.json(await search(query, limit));
  };
}

export const searchRouter = Router();
searchRouter.get('/ilike', handler(searchWithIlike));
searchRouter.get('/postgres-fts', handler(searchWithPostgresFts));
searchRouter.get('/elasticsearch', handler(searchWithElasticsearch));
