import { Pool } from 'pg';
import { Client } from '@elastic/elasticsearch';
import { config } from './config.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

export async function postgresReady(): Promise<void> {
  await pool.query('SELECT 1');
}

export const elasticsearch = new Client({ node: config.elasticsearchUrl });

export async function elasticsearchReady(): Promise<void> {
  await elasticsearch.ping();
}
