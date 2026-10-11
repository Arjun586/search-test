import { config } from './config.js';
import { elasticsearch, pool } from './db.js';

const elasticsearchIndexConfig = {
  settings: {
    analysis: {
      tokenizer: {
        partial_tokenizer: {
          type: 'ngram',
          min_gram: 3,
          max_gram: 3,
          token_chars: ['letter', 'digit'],
        },
      },
      analyzer: {
        partial_analyzer: {
          type: 'custom',
          tokenizer: 'partial_tokenizer',
          filter: ['lowercase'],
        },
      },
    },
  },
  mappings: {
    dynamic: true,
    properties: {
      id: { type: 'keyword' },
      document: { type: 'object', dynamic: true },
      // searchable_text uses 'english' for linguistic stemming, and 'partial' multi-field for substring matching.
      searchable_text: {
        type: 'text',
        analyzer: 'english',
        fields: {
          partial: {
            type: 'text',
            analyzer: 'partial_analyzer',
          },
        },
      },
    },
  },
} as const;

export async function prepareServices(): Promise<void> {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pg_trgm;

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      document JSONB NOT NULL,
      searchable_text TEXT NOT NULL,
      search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(searchable_text, ''))
      ) STORED
    );

    CREATE INDEX IF NOT EXISTS documents_search_vector_idx
      ON documents USING GIN (search_vector);

    CREATE INDEX IF NOT EXISTS documents_searchable_text_trgm_idx
      ON documents USING GIN (searchable_text gin_trgm_ops);
  `);

  const exists = await elasticsearch.indices.exists({ index: config.elasticsearchIndex });
  if (!exists) {
    await elasticsearch.indices.create({
      index: config.elasticsearchIndex,
      ...elasticsearchIndexConfig,
    });
  }
}

export async function recreateElasticsearchIndex(): Promise<void> {
  const exists = await elasticsearch.indices.exists({ index: config.elasticsearchIndex });
  if (exists) await elasticsearch.indices.delete({ index: config.elasticsearchIndex });

  await elasticsearch.indices.create({
    index: config.elasticsearchIndex,
    ...elasticsearchIndexConfig,
  });
}
