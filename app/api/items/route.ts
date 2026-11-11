import { ItemsBodySchema } from "@/lib/api-schemas";
import type { OwnedStoryItems } from "@/lib/api-types";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { jsonError, readJsonBody } from "@/lib/http";
import { adItemIds, ownedItemIds, toPublicItems } from "@/lib/items";
import type { Story } from "@/lib/schema";
import { getStoryFor } from "@/lib/stories";
import { TicketError, verifyTicket } from "@/lib/ticket";
import type { TicketPayload } from "@/lib/ticket-payload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The player's owned items across stories. Body: `{ tickets: { [storyId]: ticket } }`. A story is listed when
 * it has a valid ticket or any ad rows; an invalid ticket counts as no ticket. Owned items only.
 */
export async function POST(req: Request) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const raw = await readJsonBody(req);
  if (!raw.ok) return raw.response;
  const parsed = ItemsBodySchema.safeParse(raw.body);
  if (!parsed.success) return jsonError(400, "bad_request", "That request could not be read.");
  const { tickets } = parsed.data;
  const uid = auth.user.id;

  const withAds = (db().prepare("SELECT DISTINCT story_id FROM user_items WHERE user_id = ?").all(uid) as { story_id: string }[]).map((r) => r.story_id);
  const storyIds = [...new Set([...Object.keys(tickets), ...withAds])];

  const stories: OwnedStoryItems[] = [];
  for (const storyId of storyIds) {
    const story = getStoryFor(storyId, auth.user);
    if (!story) continue;
    let t: TicketPayload | null = null;
    try {
      t = tickets[storyId] ? verifyTicket(tickets[storyId], uid, story) : null;
    } catch (err) {
      if (!(err instanceof TicketError)) throw err;
    }
    // Without a valid ticket only the ad items count (start items belong to a run).
    const owned = t ? ownedItemIds(uid, story, t) : adOwned(uid, story);
    if (!t && owned.size === 0) continue;
    const items = toPublicItems(story, story.phases.length, owned).filter((i) => i.owned);
    if (items.length) stories.push({ storyId, title: story.title, items });
  }
  return Response.json({ stories });
}

function adOwned(uid: number, story: Story): Set<string> {
  const rows = adItemIds(uid, story.id);
  return new Set(story.items.filter((i) => i.source === "ad" && rows.has(i.id)).map((i) => i.id));
}
