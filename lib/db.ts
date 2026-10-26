import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { ChatMessage } from "./schema";

const DATA_DIR = path.join(process.cwd(), "data");

// Reuse one connection across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { __dramaDb?: Database.Database };

function open(): Database.Database {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(path.join(DATA_DIR, "drama.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress (
      story_id    TEXT PRIMARY KEY,
      phase_index INTEGER NOT NULL DEFAULT 0,
      started_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id     TEXT NOT NULL,
      character_id TEXT NOT NULL,
      role         TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content      TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_story_char ON messages (story_id, character_id, id);
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id    TEXT NOT NULL,
      phase_index INTEGER NOT NULL,
      summary     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_groups (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id    TEXT NOT NULL,
      member_ids  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Databases created before group chats have no group_id column. In a group, character_id is the
  // speaker for assistant messages and '' for the player.
  const cols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "group_id")) {
    db.exec("ALTER TABLE messages ADD COLUMN group_id INTEGER");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_messages_group ON messages (group_id, id)");
  return db;
}

export function db(): Database.Database {
  if (!globalForDb.__dramaDb) globalForDb.__dramaDb = open();
  return globalForDb.__dramaDb;
}

export function getPhaseIndex(storyId: string): number {
  const row = db().prepare("SELECT phase_index FROM progress WHERE story_id = ?").get(storyId) as
    | { phase_index: number }
    | undefined;
  return row?.phase_index ?? 0;
}

export function setPhaseIndex(storyId: string, phaseIndex: number): void {
  db()
    .prepare(
      `INSERT INTO progress (story_id, phase_index) VALUES (?, ?)
       ON CONFLICT(story_id) DO UPDATE SET phase_index = excluded.phase_index, updated_at = datetime('now')`
    )
    .run(storyId, phaseIndex);
}

export function getHistory(storyId: string, characterId: string, limit = 200): ChatMessage[] {
  const rows = db()
    .prepare(
      `SELECT role, content FROM (
         SELECT id, role, content FROM messages
         WHERE story_id = ? AND character_id = ? AND group_id IS NULL
         ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`
    )
    .all(storyId, characterId, limit) as ChatMessage[];
  return rows;
}

/**
 * A message with its context. In a one-on-one chat, characterId is the character talked to;
 * in a group (groupId set), it is the speaker, or "" when the player spoke.
 */
export type TaggedMessage = ChatMessage & { characterId: string; groupId: number | null };

/** Recent messages across every chat in a story, oldest first. */
export function getRecentStoryMessages(storyId: string, limit = 30): TaggedMessage[] {
  return db()
    .prepare(
      `SELECT character_id AS characterId, group_id AS groupId, role, content FROM (
         SELECT id, character_id, group_id, role, content FROM messages
         WHERE story_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`
    )
    .all(storyId, limit) as TaggedMessage[];
}

export function addMessage(storyId: string, characterId: string, msg: ChatMessage): void {
  db()
    .prepare("INSERT INTO messages (story_id, character_id, role, content) VALUES (?, ?, ?, ?)")
    .run(storyId, characterId, msg.role, msg.content);
}

export type Group = { id: number; storyId: string; memberIds: string[] };

type GroupRow = { id: number; story_id: string; member_ids: string };
const toGroup = (r: GroupRow): Group => ({ id: r.id, storyId: r.story_id, memberIds: JSON.parse(r.member_ids) });

export function createGroup(storyId: string, memberIds: string[]): Group {
  const res = db()
    .prepare("INSERT INTO chat_groups (story_id, member_ids) VALUES (?, ?)")
    .run(storyId, JSON.stringify(memberIds));
  return { id: Number(res.lastInsertRowid), storyId, memberIds };
}

export function getGroup(storyId: string, groupId: number): Group | null {
  const row = db().prepare("SELECT * FROM chat_groups WHERE story_id = ? AND id = ?").get(storyId, groupId) as
    | GroupRow
    | undefined;
  return row ? toGroup(row) : null;
}

export function listGroups(storyId: string): Group[] {
  const rows = db().prepare("SELECT * FROM chat_groups WHERE story_id = ? ORDER BY id ASC").all(storyId) as GroupRow[];
  return rows.map(toGroup);
}

export function getGroupHistory(groupId: number, limit = 200): TaggedMessage[] {
  return db()
    .prepare(
      `SELECT character_id AS characterId, group_id AS groupId, role, content FROM (
         SELECT id, character_id, group_id, role, content FROM messages
         WHERE group_id = ? ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`
    )
    .all(groupId, limit) as TaggedMessage[];
}

/** Recent messages from every group chat a character is in, oldest first. */
export function getGroupMessagesFor(storyId: string, characterId: string, limit = 20): TaggedMessage[] {
  return db()
    .prepare(
      `SELECT character_id AS characterId, group_id AS groupId, role, content FROM (
         SELECT m.id, m.character_id, m.group_id, m.role, m.content FROM messages m
         WHERE m.story_id = ? AND m.group_id IN (
           SELECT g.id FROM chat_groups g, json_each(g.member_ids) j WHERE g.story_id = ? AND j.value = ?
         )
         ORDER BY m.id DESC LIMIT ?
       ) ORDER BY id ASC`
    )
    .all(storyId, storyId, characterId, limit) as TaggedMessage[];
}

/** Saves a group message. `speakerId` is the character who spoke, or "" for the player. */
export function addGroupMessage(storyId: string, groupId: number, speakerId: string, msg: ChatMessage): void {
  db()
    .prepare("INSERT INTO messages (story_id, character_id, group_id, role, content) VALUES (?, ?, ?, ?, ?)")
    .run(storyId, speakerId, groupId, msg.role, msg.content);
}

export function getEvents(storyId: string): string[] {
  const rows = db()
    .prepare("SELECT summary FROM events WHERE story_id = ? ORDER BY id ASC")
    .all(storyId) as { summary: string }[];
  return rows.map((r) => r.summary);
}

export function addEvent(storyId: string, phaseIndex: number, summary: string): void {
  db()
    .prepare("INSERT INTO events (story_id, phase_index, summary) VALUES (?, ?, ?)")
    .run(storyId, phaseIndex, summary);
}

export function resetStory(storyId: string): void {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM progress WHERE story_id = ?").run(storyId);
    d.prepare("DELETE FROM messages WHERE story_id = ?").run(storyId);
    d.prepare("DELETE FROM events WHERE story_id = ?").run(storyId);
    d.prepare("DELETE FROM chat_groups WHERE story_id = ?").run(storyId);
  })();
}
