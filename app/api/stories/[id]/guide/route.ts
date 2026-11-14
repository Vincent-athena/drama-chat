import { GuideBodySchema } from "@/lib/api-schemas";
import type { GuideResponse } from "@/lib/api-types";
import { requireUser } from "@/lib/auth";
import { runGuide } from "@/lib/guide";
import { jsonError, readJsonBody } from "@/lib/http";
import { ownedItemIds } from "@/lib/items";
import { generateAdvanceGuide, hasApiKey, MissingApiKeyError } from "@/lib/llm";
import { getStoryFor, isUnlocked } from "@/lib/stories";
import { groupMembersMap, ticketFrom } from "@/lib/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Writes a personal advance guide for the current chapter from the browser-sent context. Quota: lib/guide.ts. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const story = getStoryFor(id, auth.user);
  if (!story) return jsonError(404, "not_found", "Story not found");

  const raw = await readJsonBody(req);
  if (!raw.ok) return raw.response;
  const parsed = GuideBodySchema.safeParse(raw.body);
  if (!parsed.success) return jsonError(400, "bad_request", "That request could not be read.");
  const { context } = parsed.data;

  const ticket = ticketFrom(req, auth.user.id, story);
  if (!ticket.ok) return ticket.response;
  const t = ticket.t;
  if (t.p >= story.phases.length) return jsonError(400, "bad_request", "The story is finished");
  if (!hasApiKey()) return jsonError(503, "no_api_key", new MissingApiKeyError().message);

  const owned = ownedItemIds(auth.user.id, story, t);
  const result = await runGuide(auth.user.id, () =>
    generateAdvanceGuide(
      story,
      t.p,
      story.characters.filter((c) => isUnlocked(story, c, t.p)),
      context.recent,
      context.events,
      context.notes,
      groupMembersMap(context.groupMembers),
      owned
    )
  );
  if (!result.ok) {
    return result.code === "needs_ad"
      ? jsonError(402, "needs_ad", "Watch a short ad to get another guide.", { resetsAt: result.resetsAt })
      : jsonError(502, "llm_failed", "Could not write a guide right now. Try again.");
  }
  const body: GuideResponse = { guide: result.guide, source: result.source, quota: result.quota };
  return Response.json(body);
}
