try {
  process.loadEnvFile?.();
} catch {
  // .env is optional
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL?.trim() || 'postgresql://search:search@localhost:5432/search-benchmark',
  pgSsl: process.env.PG_SSL === 'true' || process.env.DATABASE_URL?.includes('sslmode=') || false,
  elasticsearchUrl: process.env.ELASTICSEARCH_URL?.trim() || 'http://localhost:9200',
  elasticsearchApiKey: process.env.ELASTICSEARCH_API_KEY?.trim() || undefined,
  elasticsearchUsername: process.env.ELASTICSEARCH_USERNAME?.trim() || undefined,
  elasticsearchPassword: process.env.ELASTICSEARCH_PASSWORD?.trim() || undefined,
  elasticsearchIndex: process.env.ELASTICSEARCH_INDEX?.trim() || 'search_documents',
};

export const limits = {
  searchLimitDefault: 5,
  searchLimitMaximum: 100,
  queryMaximumLength: 500,
  benchmarkIterationsMaximum: 10_000,
  benchmarkWarmupMaximum: 2_000,
};

