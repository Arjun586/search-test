import { pool } from '../db.js';
import { elasticsearch } from '../elasticsearch-client.js';
import { config } from '../config.js';
import { elapsedMs, now, rounded } from '../lib/timing.js';
import type { SearchEngine, SearchResponse } from '../types.js';

// ─── ILIKE ────────────────────────────────────────────────────────────────────

/** Baseline search: deliberately uses PostgreSQL ILIKE with no trigram index.
 *  LIMIT is intentionally omitted so the engine must scan the full table
 *  when there are no matches, making the benchmark meaningful. */
export async function searchWithIlike(query: string, _limit: number): Promise<SearchResponse> {
  const started = now();
  const response = await pool.query<{ id: string }>(
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
    results: response.rows.map((row) => ({ id: row.id, document: {}, score: null })),
  };
}

// ─── PostgreSQL FTS ───────────────────────────────────────────────────────────

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

// ─── Elasticsearch ────────────────────────────────────────────────────────────

type IndexedDocument = { id: string; document: Record<string, unknown>; searchable_text: string };

/** Elasticsearch queries the normalized text built from all CSV columns except the ID column. */
export async function searchWithElasticsearch(query: string, limit: number): Promise<SearchResponse> {
  const started = now();
  const response = await elasticsearch.search<IndexedDocument>({
    index: config.elasticsearchIndex,
    size: limit,
    query: {
      multi_match: {
        query,
        fields: ['searchable_text'],
        operator: 'and',
      },
    },
  });

  return {
    engine: 'elasticsearch',
    query,
    searchLatencyMs: rounded(elapsedMs(started)),
    resultCount: response.hits.hits.length,
    results: response.hits.hits.flatMap((hit) => {
      if (!hit._source) return [];
      return [{
        id: hit._source.id ?? hit._id,
        document: hit._source.document,
        score: hit._score ?? null,
      }];
    }),
  };
}

// ─── Engine Map (used by routes and benchmark) ────────────────────────────────

export const searchEngines: Record<SearchEngine, (query: string, limit: number) => Promise<SearchResponse>> = {
  'ilike': searchWithIlike,
  'postgres-fts': searchWithPostgresFts,
  'elasticsearch': searchWithElasticsearch,
};
