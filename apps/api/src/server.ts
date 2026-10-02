import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { config } from './config.js';
import { pool, postgresReady, elasticsearch, elasticsearchReady } from './db.js';
import { HttpError, routes } from './routes.js';
import { prepareServices } from './setup.js';

const app = express();
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '100kb' }));

app.get('/health', async (_request, response) => {
  const [postgres, elasticsearch] = await Promise.allSettled([postgresReady(), elasticsearchReady()]);
  const ready = postgres.status === 'fulfilled' && elasticsearch.status === 'fulfilled';
  response.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'waiting for Docker services' });
});

app.use(routes);

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const status = error instanceof HttpError ? error.status : 500;
  if (status >= 500) console.error(error);
  response.status(status).json({ error: error instanceof Error ? error.message : 'Request failed.' });
};
app.use(errorHandler);

async function start(): Promise<void> {
  await prepareServices();
  const server = app.listen(config.port, () => console.log(`Dashboard API: http://localhost:${config.port}`));
  const stop = async () => {
    server.close();
    await Promise.all([pool.end(), elasticsearch.close()]);
  };
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
}

start().catch(async (error) => {
  console.error('Could not connect to Docker services. Run "docker compose up -d" first.');
  console.error(error instanceof Error ? error.message : error);
  await Promise.all([pool.end(), elasticsearch.close()]);
  process.exitCode = 1;
});
