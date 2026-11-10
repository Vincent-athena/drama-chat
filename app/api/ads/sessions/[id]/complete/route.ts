import type { AdReward } from "@/lib/api-types";
import { completeAdSession } from "@/lib/ads";
import { adErrorResponse } from "@/lib/ads-http";
import { requireUser } from "@/lib/auth";
import { guideQuota } from "@/lib/guide";
import { jsonError } from "@/lib/http";
import { toPublicItems } from "@/lib/items";
import { getStory } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The server decides: owned by the caller, unused, old enough by the server clock, under the daily cap. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const r = completeAdSession(auth.user.id, id);
  if (!r.ok) return adErrorResponse(r.error, r);
  if (r.reward.type === "guide") {
    const reward: AdReward = { type: "guide", quota: guideQuota(auth.user.id) };
    return Response.json({ reward });
  }
  const { storyId, itemId } = r.reward;
  const story = getStory(storyId);
  const item = story && toPublicItems(story, story.phases.length, new Set([itemId])).find((i) => i.id === itemId);
  if (!item) return jsonError(404, "not_found", "Story not found");
  const reward: AdReward = { type: "item", storyId, item };
  return Response.json({ reward });
}
