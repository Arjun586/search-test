import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse';
import { config } from '../config.js';
import { elasticsearch, pool } from '../db.js';
import { recreateElasticsearchIndex } from '../setup.js';

const inputFolder = path.resolve(process.cwd(), 'data');
const batchSize = 500;

type CsvDocument = {
  id: string;
  document: Record<string, string>;
  searchableText: string;
};

export type ImportSummary = {
  fileName: string;
  columns: string[];
  documentCount: number;
};

async function getCsvFile(): Promise<{ fileName: string; filePath: string }> {
  const files = (await readdir(inputFolder)).filter((file) => file.toLowerCase().endsWith('.csv'));
  if (files.length === 0) {
    throw new Error('Put one CSV file in data, then try again.');
  }
  if (files.length > 1) {
    throw new Error('data contains more than one CSV file. Keep only the file you want to import.');
  }
  return { fileName: files[0], filePath: path.join(inputFolder, files[0]) };
}

function createDocument(row: Record<string, string>, idColumn: string): CsvDocument {
  const id = row[idColumn]?.trim();
  if (!id) throw new Error(`Missing document ID in column "${idColumn}".`);
  return {
    id,
    document: row,
    searchableText: Object.entries(row)
      .filter(([column]) => column !== idColumn)
      .map(([, value]) => value)
      .filter(Boolean)
      .join(' '),
  };
}

async function saveBatch(documents: CsvDocument[]): Promise<void> {
  const unique = [...new Map(documents.map((document) => [document.id, document])).values()];
  const values: unknown[] = [];
  const rows = unique.map((document, index) => {
    const position = index * 3;
    values.push(document.id, JSON.stringify(document.document), document.searchableText);
    return `($${position + 1}, $${position + 2}::jsonb, $${position + 3})`;
  });

  await pool.query(
    `INSERT INTO documents (id, document, searchable_text)
     VALUES ${rows.join(', ')}
     ON CONFLICT (id) DO UPDATE SET
       document = EXCLUDED.document,
       searchable_text = EXCLUDED.searchable_text`,
    values,
  );

  const operations = unique.flatMap((document) => [
    { index: { _index: config.elasticsearchIndex, _id: document.id } },
    { id: document.id, document: document.document, searchable_text: document.searchableText },
  ]);
  const result = await elasticsearch.bulk({ operations });
  if (!result.errors) return;

  const failed = result.items.find((item) => item.index?.error)?.index?.error;
  throw new Error(`Elasticsearch could not index the CSV: ${failed?.reason ?? 'unknown bulk error'}`);
}

/** Replaces the previously imported corpus with the single CSV in data. */
export async function importCsv(): Promise<ImportSummary> {
  const { fileName, filePath } = await getCsvFile();
  await pool.query('TRUNCATE documents');
  await recreateElasticsearchIndex();

  const parser = createReadStream(filePath, { encoding: 'utf8' }).pipe(parse({
    columns: true,
    bom: true,
    skip_empty_lines: true,
  }));

  let columns: string[] | undefined;
  let idColumn = '';
  let documentCount = 0;
  let batch: CsvDocument[] = [];

  for await (const rawRow of parser) {
    const row = rawRow as Record<string, string>;
    if (!columns) {
      columns = Object.keys(row);
      if (columns.length === 0) throw new Error('The CSV must contain a header row.');
      idColumn = columns[0];
    }
    try {
      batch.push(createDocument(row, idColumn));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid CSV row.';
      throw new Error(`CSV row ${documentCount + 2}: ${message}`);
    }
    documentCount += 1;

    if (batch.length === batchSize) {
      await saveBatch(batch);
      batch = [];
    }
  }

  if (!columns) throw new Error('The CSV has no data rows.');
  if (batch.length) await saveBatch(batch);
  await elasticsearch.indices.refresh({ index: config.elasticsearchIndex });
  return { fileName, columns, documentCount };
}
