import { pool } from '../db.js';
import { elapsedMs, now, rounded } from '../lib/timing.js';
import type { SearchResponse } from '../types.js';

type FtsRow = { id: string; document: Record<string, unknown>; score: number | string };

/** Native PostgreSQL FTS: tsvector + websearch_to_tsquery + ts_rank. */
export async function searchWithPostgresFts(query: string, limit: number): Promise<SearchResponse> {
  const started = now();
  const response = await pool.query<FtsRow>(
    `WITH parsed_query AS (
       SELECT websearch_to_tsquery('english', $1) AS value
     )
     SELECT d.id, d.document, ts_rank(d.search_vector, q.value) AS score
     FROM documents d
     CROSS JOIN parsed_query q
     WHERE d.search_vector @@ q.value
     ORDER BY score DESC
     LIMIT $2`,
    [query, limit],
  );

  return {
    engine: 'postgres-fts',
    query,
    searchLatencyMs: rounded(elapsedMs(started)),
    resultCount: response.rows.length,
    results: response.rows.map((row) => ({
      id: row.id,
      document: row.document,
      score: Number(row.score),
    })),
  };
}
