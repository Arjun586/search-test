import { Pool } from 'pg';
import { config } from './config.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
});

export async function postgresReady(): Promise<void> {
  await pool.query('SELECT 1');
}
