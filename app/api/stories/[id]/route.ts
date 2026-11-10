import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { ownedItemIds } from "@/lib/items";
import { hasApiKey } from "@/lib/llm";
import { getStory, toPublicStory } from "@/lib/stories";
import { freshTicket, TicketError, verifyTicket } from "@/lib/ticket";
import { TICKET_INVALID_MESSAGE, TICKET_HEADER } from "@/lib/ticket-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireUser(req);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const story = getStory(id);
  if (!story) return jsonError(404, "not_found", "Story not found");

  const given = req.headers.get(TICKET_HEADER);
  let ticket: string;
  try {
    ticket = given ?? freshTicket(auth.user.id, story.id);
    const t = verifyTicket(ticket, auth.user.id, story);
    const owned = ownedItemIds(auth.user.id, story, t);
    return Response.json({ story: toPublicStory(story, t.p, owned), ticket, hasApiKey: hasApiKey() });
  } catch (err) {
    if (err instanceof TicketError) return jsonError(400, "ticket_invalid", TICKET_INVALID_MESSAGE);
    throw err;
  }
}
