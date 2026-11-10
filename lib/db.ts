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
  // v2 (WP3): items the player owns for good (granted by ads). Found items live in the signed ticket.
  (d) => {
    d.exec(`
      CREATE TABLE user_items (
        user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        story_id      TEXT NOT NULL,
        item_id       TEXT NOT NULL,
        acquired_at   INTEGER NOT NULL,
        ad_session_id TEXT,
        PRIMARY KEY (user_id, story_id, item_id)
      );
    `);
  },
  // v3 (WP4): rewarded ad sessions. A row is the server's proof that an ad was started, and when.
  (d) => {
    d.exec(`
      CREATE TABLE ad_sessions (
        id           TEXT PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reward_type  TEXT NOT NULL CHECK (reward_type IN ('item','guide')),
        story_id     TEXT NOT NULL,
        item_id      TEXT,
        provider     TEXT NOT NULL,
        started_at   INTEGER NOT NULL,
        completed_at INTEGER,
        redeemed_at  INTEGER,
        status       TEXT NOT NULL CHECK (status IN ('started','completed','abandoned'))
      );
      CREATE INDEX idx_ad_sessions_user ON ad_sessions (user_id, status, completed_at);
    `);
  },
  // v4: what the viewer actually saw, as claimed by the browser: 'network' or 'house'. Informational (fill rate).
  (d) => {
    d.exec("ALTER TABLE ad_sessions ADD COLUMN shown TEXT");
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
