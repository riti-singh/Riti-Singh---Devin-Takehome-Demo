import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  return db;
}

export function migrate(db: Db): void {
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
}

export function createDb(file = process.env.DATABASE_FILE ?? 'data/refunds.db'): Db {
  const db = openDb(file);
  migrate(db);
  return db;
}
