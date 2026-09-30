import { pool } from './db.js';
import { ensureElasticsearchIndex } from './services/elasticsearch-index.js';

export async function prepareServices(): Promise<void> {
  await pool.query(`
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
  `);
  await ensureElasticsearchIndex();
}
