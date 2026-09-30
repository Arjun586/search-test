import { elasticsearch } from '../elasticsearch-client.js';
import { config } from '../config.js';
import { elapsedMs, now, rounded } from '../lib/timing.js';
import type { SearchResponse } from '../types.js';

type IndexedDocument = { id: string; document: Record<string, unknown>; searchable_text: string };

/** Elasticsearch queries the normalized text built from exactly SEARCH_FIELDS. */
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
