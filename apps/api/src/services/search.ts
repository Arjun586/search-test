import { config } from '../config.js';
import { elasticsearch, pool } from '../db.js';
import type { SearchEngine, SearchResponse } from '../types.js';

const now = () => performance.now();
const elapsedMs = (start: number) => performance.now() - start;
const rounded = (n: number) => Math.round(n * 1000) / 1000;

// ─── ILIKE ────────────────────────────────────────────────────────────────────

type IlikeRow = { id: string; document: Record<string, unknown>; total_count: string };

/** PostgreSQL ILIKE: Evaluates documents using a GIN trigram index.
 *  Uses a window count to calculate total corpus matches while returning the filtered top documents. */
export async function searchWithIlike(query: string, limit = 5): Promise<SearchResponse> {
  const started = now();
  const response = await pool.query<IlikeRow>(
    `WITH matched AS (
       SELECT id, document, count(*) OVER () AS total_count
       FROM documents
       WHERE searchable_text ILIKE '%' || $1 || '%'
     )
     SELECT id, document, total_count
     FROM matched
     LIMIT $2`,
    [query, limit],
  );

  const resultCount = response.rows.length > 0 ? Number(response.rows[0].total_count) : 0;
  return {
    engine: 'ilike',
    query,
    searchLatencyMs: rounded(elapsedMs(started)),
    resultCount,
    results: response.rows.map((row) => ({ id: row.id, document: row.document, score: null })),
  };
}

// ─── PostgreSQL FTS ───────────────────────────────────────────────────────────

type FtsRow = { id: string; document: Record<string, unknown>; score: number | string; total_count: string };

/** Native PostgreSQL FTS: tsvector + websearch_to_tsquery + ts_rank.
 *  Scores all matching documents in the corpus and returns the top 5 with the full match count. */
export async function searchWithPostgresFts(query: string, limit = 5): Promise<SearchResponse> {
  const started = now();
  const response = await pool.query<FtsRow>(
    `WITH parsed_query AS (
       SELECT websearch_to_tsquery('english', $1) AS value
     ),
     matched AS (
       SELECT d.id, d.document, ts_rank(d.search_vector, q.value) AS score, count(*) OVER () AS total_count
       FROM documents d
       CROSS JOIN parsed_query q
       WHERE d.search_vector @@ q.value
     )
     SELECT id, document, score, total_count
     FROM matched
     ORDER BY score DESC
     LIMIT $2`,
    [query, limit],
  );

  const resultCount = response.rows.length > 0 ? Number(response.rows[0].total_count) : 0;
  return {
    engine: 'postgres-fts',
    query,
    searchLatencyMs: rounded(elapsedMs(started)),
    resultCount,
    results: response.rows.map((row) => ({
      id: row.id,
      document: row.document,
      score: Number(row.score),
    })),
  };
}

// ─── Elasticsearch ────────────────────────────────────────────────────────────

type IndexedDocument = { id: string; document: Record<string, unknown>; searchable_text: string };

/** Elasticsearch: Queries searchable_text with track_total_hits enabled to evaluate the full index. */
export async function searchWithElasticsearch(query: string, limit = 5): Promise<SearchResponse> {
  const started = now();
  const response = await elasticsearch.search<IndexedDocument>({
    index: config.elasticsearchIndex,
    size: limit,
    track_total_hits: true,
    query: {
      multi_match: {
        query,
        fields: ['searchable_text'],
        operator: 'and',
      },
    },
  });

  const totalHits = response.hits.total;
  const resultCount = typeof totalHits === 'number' ? totalHits : (totalHits?.value ?? response.hits.hits.length);

  return {
    engine: 'elasticsearch',
    query,
    searchLatencyMs: rounded(elapsedMs(started)),
    resultCount,
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
