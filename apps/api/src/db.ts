import { Pool } from 'pg';
import { Client } from '@elastic/elasticsearch';
import { config } from './config.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  ssl: config.pgSsl ? { rejectUnauthorized: false } : undefined,
});

export async function postgresReady(): Promise<void> {
  await pool.query('SELECT 1');
}

export const elasticsearch = new Client({
  node: config.elasticsearchUrl,
  auth: config.elasticsearchApiKey
    ? { apiKey: config.elasticsearchApiKey }
    : config.elasticsearchUsername && config.elasticsearchPassword
    ? { username: config.elasticsearchUsername, password: config.elasticsearchPassword }
    : undefined,
  tls: config.elasticsearchUrl.startsWith('https://')
    ? { rejectUnauthorized: false }
    : undefined,
});

export async function elasticsearchReady(): Promise<void> {
  await elasticsearch.ping();
}
