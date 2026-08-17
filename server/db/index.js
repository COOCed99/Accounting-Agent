import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import 'dotenv/config';

const DB_PATH = process.env.DB_PATH || './data/runway.db';

fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

export const db = new Database(path.resolve(DB_PATH));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export { DB_PATH };
