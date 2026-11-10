import { AdStartBodySchema } from "@/lib/api-schemas";
import { startAdSession } from "@/lib/ads";
import { adErrorResponse } from "@/lib/ads-http";
import { requireUser } from "@/lib/auth";
import { jsonError, readJsonBody } from "@/lib/http";
import { getStory } from "@/lib/stories";
import { ticketFrom } from "@/lib/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Starts a rewarded ad session. Items need the save ticket header; a guide only needs a known story. */
export async function POST(req: Request) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const raw = await readJsonBody(req, 4_000);
  if (!raw.ok) return raw.response;
  const parsed = AdStartBodySchema.safeParse(raw.body);
  if (!parsed.success) return jsonError(400, "bad_request", "That ad request could not be read.");
  const body = parsed.data;
  const story = getStory(body.storyId);
  if (!story) return jsonError(404, "not_found", "Story not found");

  let t = null;
  if (body.rewardType === "item") {
    const ticket = ticketFrom(req, auth.user.id, story);
    if (!ticket.ok) return ticket.response;
    t = ticket.t;
  }
  const r = startAdSession(auth.user.id, body, { story, ticket: t });
  if (!r.ok) return adErrorResponse(r.error, r);
  return Response.json({ session: r.session });
}
