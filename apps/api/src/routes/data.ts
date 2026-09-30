import { Router } from 'express';
import { HttpError } from '../lib/http-error.js';
import { importCsv } from '../services/importer.js';

let importing = false;

export const dataRouter = Router();

dataRouter.post('/import', async (_request, response) => {
  if (importing) throw new HttpError(409, 'A CSV import is already running.');
  importing = true;
  try {
    response.json(await importCsv());
  } finally {
    importing = false;
  }
});
