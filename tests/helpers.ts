import { createDb, type Db } from '../src/db/index.js';
import { seed } from '../src/db/seed.js';

export function freshDb(): Db {
  const db = createDb(':memory:');
  seed(db);
  return db;
}
