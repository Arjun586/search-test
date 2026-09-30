export const config = {
  port: 4000,
  corsOrigin: 'http://localhost:5173',
  databaseUrl: 'postgresql://search:search@localhost:5432/search_benchmark',
  elasticsearchUrl: 'http://localhost:9200',
  elasticsearchIndex: 'search_documents',
};

export const limits = {
  searchLimitDefault: 20,
  searchLimitMaximum: 100,
  queryMaximumLength: 500,
  benchmarkIterationsMaximum: 10_000,
  benchmarkWarmupMaximum: 2_000,
};
