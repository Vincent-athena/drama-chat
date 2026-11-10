/** Rewarded ad sessions. Server only. The browser can ask for a session; only the server decides it was watched. */
import crypto from "node:crypto";
import type { AdSessionView, AdStartBody } from "./api-types";
import { db } from "./db";
import { dayKey, nextDayStart } from "./day";
import { adDailyCap, adMinSeconds } from "./env";
import { grantAdItem, ownedItemIds } from "./items";
import { hit } from "./limits";
import type { Story } from "./schema";
import type { TicketPayload } from "./ticket-payload";

export type AdError = "not_found" | "too_early" | "used" | "ad_cap" | "already_owned" | "bad_request" | "rate_limited";
export type AdFailure = { ok: false; error: AdError; retryAfter?: number; resetsAt?: number };

const HOUR = 3_600_000;
const START_LIMIT_PER_HOUR = 30;

type Row = {
  id: string;
  user_id: number;
  reward_type: "item" | "guide";
  story_id: string;
  item_id: string | null;
  started_at: number;
  status: "started" | "completed" | "abandoned";
};

/** Completed ad sessions of the user within the current DAY_TZ day (both rewards share this). */
export function completedAdsToday(userId: number, now: number = Date.now()): number {
  // No day is longer than 25 hours, so a 26-hour look-back catches every row of today; the key does the rest.
  const rows = db()
    .prepare("SELECT completed_at FROM ad_sessions WHERE user_id = ? AND status = 'completed' AND completed_at >= ?")
    .all(userId, now - 26 * HOUR) as { completed_at: number }[];
  const today = dayKey(now);
  return rows.filter((r) => r.completed_at <= now && dayKey(r.completed_at) === today).length;
}

/** Completed guide ads that have not bought a guide yet. */
export function guideCredits(userId: number): number {
  const r = db()
    .prepare("SELECT COUNT(*) AS n FROM ad_sessions WHERE user_id = ? AND reward_type = 'guide' AND status = 'completed' AND redeemed_at IS NULL")
    .get(userId) as { n: number };
  return r.n;
}

export function startAdSession(
  userId: number,
  body: AdStartBody,
  ctx: { story: Story; ticket: TicketPayload | null },
  now: number = Date.now()
): { ok: true; session: AdSessionView } | AdFailure {
  const { story, ticket } = ctx;
  if (body.storyId !== story.id) return { ok: false, error: "bad_request" };
  let itemId: string | null = null;
  if (body.rewardType === "item") {
    if (!ticket) return { ok: false, error: "bad_request" };
    const item = story.items.find((i) => i.id === body.itemId);
    if (!item || item.source !== "ad") return { ok: false, error: "bad_request" };
    const at = story.phases.findIndex((p) => p.id === item.availablePhase);
    if (at < 0 || at > ticket.p) return { ok: false, error: "bad_request" };
    if (ownedItemIds(userId, story, ticket).has(item.id)) return { ok: false, error: "already_owned" };
    itemId = item.id;
  }
  if (completedAdsToday(userId, now) >= adDailyCap()) {
    return { ok: false, error: "ad_cap", resetsAt: nextDayStart(now) };
  }
  const rate = hit(`adstart:${userId}`, HOUR, START_LIMIT_PER_HOUR, now);
  if (!rate.ok) return { ok: false, error: "rate_limited", retryAfter: rate.retryAfter };

  const id = crypto.randomBytes(16).toString("hex");
  db()
    .prepare(
      `INSERT INTO ad_sessions (id, user_id, reward_type, story_id, item_id, provider, started_at, status)
       VALUES (?, ?, ?, ?, ?, 'standin', ?, 'started')`
    )
    .run(id, userId, body.rewardType, story.id, itemId, now);
  return { ok: true, session: { id, provider: "standin", rewardType: body.rewardType, minSeconds: adMinSeconds(), startedAt: now } };
}

/**
 * Completes a session in one transaction. The row must belong to the caller (anything else is `not_found`,
 * so another user's id looks like an unknown one), be unused, old enough by the SERVER clock, and the user
 * must be under the daily cap. An item is granted here; a guide leaves one unredeemed credit.
 */
export function completeAdSession(
  userId: number,
  sessionId: string,
  now: number = Date.now()
):
  | { ok: true; reward: { type: "item"; storyId: string; itemId: string } | { type: "guide" } }
  | AdFailure {
  return db().transaction((): ReturnType<typeof completeAdSession> => {
    const row = db().prepare("SELECT * FROM ad_sessions WHERE id = ? AND user_id = ?").get(sessionId, userId) as Row | undefined;
    if (!row) return { ok: false, error: "not_found" };
    if (row.status !== "started") return { ok: false, error: "used" };
    const minMs = adMinSeconds() * 1000;
    if (now - row.started_at < minMs) {
      return { ok: false, error: "too_early", retryAfter: Math.max(1, Math.ceil((minMs - (now - row.started_at)) / 1000)) };
    }
    if (completedAdsToday(userId, now) >= adDailyCap()) {
      return { ok: false, error: "ad_cap", resetsAt: nextDayStart(now) };
    }
    if (row.reward_type === "item" && row.item_id) {
      db().prepare("UPDATE ad_sessions SET status = 'completed', completed_at = ?, redeemed_at = ? WHERE id = ?").run(now, now, row.id);
      grantAdItem(userId, row.story_id, row.item_id, row.id, now);
      return { ok: true, reward: { type: "item", storyId: row.story_id, itemId: row.item_id } };
    }
    db().prepare("UPDATE ad_sessions SET status = 'completed', completed_at = ? WHERE id = ?").run(now, row.id);
    return { ok: true, reward: { type: "guide" } };
  })();
}

/** Idempotent: only the caller's own `started` session changes. Returns whether something changed. */
export function abandonAdSession(userId: number, sessionId: string, now: number = Date.now()): boolean {
  void now;
  const r = db().prepare("UPDATE ad_sessions SET status = 'abandoned' WHERE id = ? AND user_id = ? AND status = 'started'").run(sessionId, userId);
  return r.changes === 1;
}
