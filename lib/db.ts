import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./env";

// Reuse one connection across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __dramaDb?: Database.Database };

/** Index i becomes user_version i+1. Never edit an accepted migration; append a new one. */
export const MIGRATIONS: ((d: Database.Database) => void)[] = [
  // v1 (WP1): accounts. Game state lives in the browser, so the legacy game tables are dropped.
  (d) => {
    d.exec(`
      DROP TABLE IF EXISTS messages; DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS chapter_notes;
      DROP TABLE IF EXISTS chat_groups; DROP TABLE IF EXISTS progress;
      CREATE TABLE users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT NOT NULL UNIQUE,
        display_name  TEXT NOT NULL,
        avatar_emoji  TEXT NOT NULL DEFAULT '🎭',
        created_at    INTEGER NOT NULL,
        last_login_at INTEGER NOT NULL
      );
      CREATE TABLE login_codes (
        email      TEXT PRIMARY KEY,
        code_hash  TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts   INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE sessions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash   TEXT NOT NULL UNIQUE,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL,
        user_agent   TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_sessions_user ON sessions (user_id);
      CREATE TABLE counters (
        key        TEXT PRIMARY KEY,
        count      INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  },
];

function runMigrations(d: Database.Database): void {
  const current = d.pragma("user_version", { simple: true }) as number;
  for (let i = current; i < MIGRATIONS.length; i++) {
    d.transaction(() => {
      MIGRATIONS[i](d);
      d.pragma(`user_version = ${i + 1}`);
    })();
  }
}

function open(): Database.Database {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const d = new Database(path.join(dir, "drama.db"));
  d.pragma("journal_mode = WAL");
  d.pragma("foreign_keys = ON");
  runMigrations(d);
  return d;
}

export function db(): Database.Database {
  if (!globalForDb.__dramaDb) globalForDb.__dramaDb = open();
  return globalForDb.__dramaDb;
}
