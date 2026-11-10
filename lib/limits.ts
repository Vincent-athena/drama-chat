import { db } from "./db";
import { CONTEXT_LIMITS } from "./limits-shared";

export { CONTEXT_LIMITS };

/**
 * Fixed-window counter. The key gets the window number appended. Returns whether this hit is within
 * `limit`, the count including it, and seconds until the window ends.
 */
export function hit(
  key: string,
  windowMs: number,
  limit: number,
  now: number = Date.now()
): { ok: boolean; count: number; retryAfter: number } {
  const win = Math.floor(now / windowMs);
  const expiresAt = (win + 1) * windowMs;
  return hitUntil(`${key}:${win}`, expiresAt, limit, now);
}

/** Like `hit`, but the window is explicit: the counter row lives until `expiresAt` (e.g. the end of a local day). */
export function hitUntil(
  fullKey: string,
  expiresAt: number,
  limit: number,
  now: number = Date.now()
): { ok: boolean; count: number; retryAfter: number } {
  const d = db();
  if (Math.random() < 1 / 50) d.prepare("DELETE FROM counters WHERE expires_at <= ?").run(now);
  const row = d
    .prepare(
      `INSERT INTO counters (key, count, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`
    )
    .get(fullKey, expiresAt) as { count: number };
  return { ok: row.count <= limit, count: row.count, retryAfter: Math.max(1, Math.ceil((expiresAt - now) / 1000)) };
}

/** Reads a counter without incrementing it. */
export function peek(fullKey: string, now: number = Date.now()): number {
  const row = db().prepare("SELECT count FROM counters WHERE key = ? AND expires_at > ?").get(fullKey, now) as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}
