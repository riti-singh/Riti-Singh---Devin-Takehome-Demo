import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.js';
import { createDb } from './db/index.js';
import { resetAndSeed } from './db/seed.js';

const file = process.env.DATABASE_FILE ?? 'data/refunds.db';
mkdirSync(dirname(file), { recursive: true });

const db = existsSync(file) ? createDb(file) : resetAndSeed(file);
const port = Number(process.env.PORT ?? 3000);

createApp({ db }).listen(port, () => {
  console.log(`Refund Operations listening on http://localhost:${port}`);
});
