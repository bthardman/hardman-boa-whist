// A stand-in for Cloudflare D1 backed by Node's built-in SQLite (Node 22+), for tests and for
// running the stats API locally. Not used in production (Cloudflare provides the real D1).
import { createRequire } from 'node:module';
import type { SQLInputValue } from 'node:sqlite';
import type { D1Like, D1Statement } from './db.ts';

// Loaded via require: Vite (used by the tests) mistakes 'node:sqlite' for a package called 'sqlite'.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

type LocalStatement = D1Statement & { runNow(): unknown };

export function sqliteD1(file = ':memory:'): D1Like {
  const db = new DatabaseSync(file);
  const statement = (sql: string, params: SQLInputValue[] = []): LocalStatement => ({
    bind: (...values) => statement(sql, values as SQLInputValue[]),
    runNow: () => db.prepare(sql).run(...params),
    run: async () => db.prepare(sql).run(...params),
    all: async <T>() => ({ results: db.prepare(sql).all(...params) as T[] })
  });
  return {
    prepare: (sql) => statement(sql),
    // Like D1's batch: all or nothing.
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = statements.map((s) => (s as LocalStatement).runNow());
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  };
}
