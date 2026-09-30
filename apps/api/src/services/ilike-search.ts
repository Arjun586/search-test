import { pool } from '../db.js';
import { elapsedMs, now, rounded } from '../lib/timing.js';
import type { SearchResponse } from '../types.js';

/** Baseline search: deliberately uses PostgreSQL ILIKE with no trigram index. */
export async function searchWithIlike(query: string, limit: number): Promise<SearchResponse> {
  const started = now();
  const response = await pool.query<{ id: string; document: Record<string, unknown> }>(
    `SELECT id
     FROM documents
     WHERE searchable_text ILIKE '%' || $1 || '%'`,
    [query],
  );

  return {
    engine: 'ilike',
    query,
    searchLatencyMs: rounded(elapsedMs(started)),
    resultCount: response.rows.length,
    results: response.rows.map((row) => ({ ...row, score: null })),
  };
}
