import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

export type Db = DatabaseSync;

export function openDb(dbPath: string): Db {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  migrate(db);
  return db;
}

function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        file,
        Date.now(),
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Runs `fn` inside a transaction. node:sqlite has no transaction helper of its
 * own, and nesting is handled with savepoints so callers can compose freely.
 */
let depth = 0;
export function transaction<T>(db: Db, fn: () => T): T {
  const name = `sp_${depth}`;
  db.exec(depth === 0 ? "BEGIN" : `SAVEPOINT ${name}`);
  depth++;
  try {
    const result = fn();
    depth--;
    db.exec(depth === 0 ? "COMMIT" : `RELEASE ${name}`);
    return result;
  } catch (err) {
    depth--;
    db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}`);
    throw err;
  }
}
