import { ChatTurnBodySchema } from "@/lib/api-schemas";
import { requireUser } from "@/lib/auth";
import { judgeTurn } from "@/lib/director";
import { jsonError, readJsonBody } from "@/lib/http";
import { chatWithCharacter } from "@/lib/llm";
import { CONTEXT_LIMITS } from "@/lib/limits-shared";
import type { TaggedMessage } from "@/lib/schema";
import { getStory, isUnlocked } from "@/lib/stories";
import { admit, groupMembersMap, lockedResponse, NDJSON_HEADERS, itemContext, ticketFrom } from "@/lib/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; charId: string }> };

/**
 * Streams NDJSON lines:
 *   {"type":"delta","text":"..."}            reply tokens
 *   {"type":"replied"}                       reply finished; the browser saves the turn now
 *   {"type":"done","ticket":...,...}         after the director has judged the turn
 *   {"type":"error","message":"..."}
 * Every rejection happens before the stream starts, as a normal JSON error response.
 */
export async function POST(req: Request, { params }: Params) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const { id, charId } = await params;
  const story = getStory(id);
  if (!story) return jsonError(404, "not_found", "Story not found");
  const character = story.characters.find((c) => c.id === charId);
  if (!character) return jsonError(404, "not_found", "Character not found");

  const raw = await readJsonBody(req);
  if (!raw.ok) return raw.response;
  const parsed = ChatTurnBodySchema.safeParse(raw.body);
  if (!parsed.success) return jsonError(400, "bad_request", "That message could not be read.");
  const { message, showItemId, context } = parsed.data;

  const ticket = ticketFrom(req, auth.user.id, story);
  if (!ticket.ok) return ticket.response;
  const t = ticket.t;
  const items = itemContext(auth.user.id, story, t, showItemId);
  if (!items.ok) return items.response;
  if (!isUnlocked(story, character, t.p)) return lockedResponse();
  const blocked = admit(auth.user.id);
  if (blocked) return blocked;

  const groupMembers = groupMembersMap(context.groupMembers);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        let reply = "";
        for await (const delta of chatWithCharacter(story, character, t.p, context.events, context.history, message, {
          groupChats: context.groupChats,
          groupMembers,
          playerName: auth.user.displayName,
          carrying: items.carrying,
          shownItem: items.shownItem,
        })) {
          reply += delta;
          send({ type: "delta", text: delta });
        }
        send({ type: "replied" });
        const thisTurn: TaggedMessage[] = [
          { role: "user", content: message, characterId: charId, groupId: null },
          { role: "assistant", content: reply, characterId: charId, groupId: null },
        ];
        send(
          await judgeTurn({
            story,
            ticket: t,
            ticketString: ticket.raw,
            owned: items.owned,
            recent: [...context.recent, ...thisTurn].slice(-CONTEXT_LIMITS.recent),
            events: context.events,
            notes: context.notes,
            groupMembers,
          })
        );
      } catch (err) {
        console.error("chat error", err instanceof Error ? err.message : err);
        // The provider's own error text stays in the server log; players get a plain message.
        send({ type: "error", message: "The reply was interrupted. Please send your message again.", code: "llm_failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
