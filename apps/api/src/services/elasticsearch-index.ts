import { config } from '../config.js';
import { elasticsearch } from '../elasticsearch-client.js';

export async function ensureElasticsearchIndex(): Promise<void> {
  const exists = await elasticsearch.indices.exists({ index: config.elasticsearchIndex });
  if (exists) return;

  await elasticsearch.indices.create({
    index: config.elasticsearchIndex,
    mappings: {
      dynamic: true,
      properties: {
        id: { type: 'keyword' },
        document: { type: 'object', dynamic: true },
        // This is the combined text from every CSV column except the ID column.
        searchable_text: { type: 'text', analyzer: 'standard' },
      },
    },
  });
}

export async function recreateElasticsearchIndex(): Promise<void> {
  const exists = await elasticsearch.indices.exists({ index: config.elasticsearchIndex });
  if (exists) await elasticsearch.indices.delete({ index: config.elasticsearchIndex });
  await ensureElasticsearchIndex();
}
