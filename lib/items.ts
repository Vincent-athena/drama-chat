/** Item ownership and gates. Server only: reads the database. */
import type { PublicItem } from "./api-types";
import { db } from "./db";
import type { Item, Story } from "./schema";
import type { TicketPayload } from "./ticket-payload";

const phaseIndexOf = (story: Story, phaseId: string) => story.phases.findIndex((p) => p.id === phaseId);

/** Ad-granted item ids the user holds in this story (rows in `user_items`). */
export function adItemIds(userId: number, storyId: string): Set<string> {
  const rows = db().prepare("SELECT item_id FROM user_items WHERE user_id = ? AND story_id = ?").all(userId, storyId) as { item_id: string }[];
  return new Set(rows.map((r) => r.item_id));
}

/** Start items, plus the found items in the ticket, plus the ad items bought for good. */
export function ownedItemIds(userId: number, story: Story, t: TicketPayload): Set<string> {
  const owned = new Set<string>();
  for (const item of story.items) if (item.source === "start") owned.add(item.id);
  const found = new Set(story.items.filter((i) => i.source === "found").map((i) => i.id));
  for (const id of t.f) if (found.has(id)) owned.add(id);
  const ads = adItemIds(userId, story.id);
  for (const item of story.items) if (item.source === "ad" && ads.has(item.id)) owned.add(item.id);
  return owned;
}

/** Idempotent: granting the same item twice keeps the first row. WP4 calls this when an ad completes. */
export function grantAdItem(userId: number, storyId: string, itemId: string, adSessionId: string | null, now: number = Date.now()): void {
  db()
    .prepare("INSERT OR IGNORE INTO user_items (user_id, story_id, item_id, acquired_at, ad_session_id) VALUES (?, ?, ?, ?, ?)")
    .run(userId, storyId, itemId, now, adSessionId);
}

/** Required items of the chapter that the player does not own. */
export function missingRequired(story: Story, phaseIndex: number, owned: Set<string>): string[] {
  const phase = story.phases[phaseIndex];
  return phase ? phase.requiredItems.filter((id) => !owned.has(id)) : [];
}

/** Found items the director may grant right now: available by this chapter and not owned yet. */
export function findableItems(story: Story, phaseIndex: number, owned: Set<string>): Item[] {
  return story.items.filter((i) => i.source === "found" && !owned.has(i.id) && phaseIndexOf(story, i.availablePhase) <= phaseIndex);
}

/**
 * The browser's view of the items. Items from a later chapter are hidden unless owned; the description of a
 * found item is withheld until the player owns it. obtainCriteria never leaves the server.
 */
export function toPublicItems(story: Story, phaseIndex: number, owned: Set<string>): PublicItem[] {
  const out: PublicItem[] = [];
  for (const i of story.items) {
    const isOwned = owned.has(i.id);
    const at = phaseIndexOf(story, i.availablePhase);
    if (at > phaseIndex && !isOwned) continue;
    out.push({
      id: i.id,
      name: i.name,
      emoji: i.emoji,
      source: i.source,
      description: i.source === "found" && !isOwned ? "" : i.description,
      availablePhaseIndex: at,
      owned: isOwned,
    });
  }
  return out;
}
