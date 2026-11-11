import { GroupTurnBodySchema } from "@/lib/api-schemas";
import { requireUser } from "@/lib/auth";
import { judgeTurn } from "@/lib/director";
import { jsonError, readJsonBody } from "@/lib/http";
import { chatInGroup, pickSpeakers } from "@/lib/llm";
import { CONTEXT_LIMITS } from "@/lib/limits-shared";
import type { TaggedMessage } from "@/lib/schema";
import { getStoryFor } from "@/lib/stories";
import { admit, charactersLocked, groupMembersMap, lockedResponse, NDJSON_HEADERS, itemContext, ticketFrom } from "@/lib/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Streams NDJSON lines:
 *   {"type":"speaker","characterId":"..."}   a character starts replying
 *   {"type":"delta","text":"..."}            that character's reply tokens
 *   {"type":"replied"}                       every reply finished; the browser saves the round now
 *   {"type":"done","ticket":...,...}         after the director has judged the turn
 *   {"type":"error","message":"..."}
 */
export async function POST(req: Request, { params }: Params) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const story = getStoryFor(id, auth.user);
  if (!story) return jsonError(404, "not_found", "Story not found");

  const raw = await readJsonBody(req);
  if (!raw.ok) return raw.response;
  const parsed = GroupTurnBodySchema.safeParse(raw.body);
  if (!parsed.success) return jsonError(400, "bad_request", "That message could not be read.");
  const { message, showItemId, group, context } = parsed.data;
  if (new Set(group.memberIds).size !== group.memberIds.length) {
    return jsonError(400, "bad_request", "A group cannot list the same character twice.");
  }
  if (group.memberIds.some((m) => !story.characters.some((c) => c.id === m))) {
    return jsonError(404, "not_found", "Character not found");
  }

  const ticket = ticketFrom(req, auth.user.id, story);
  if (!ticket.ok) return ticket.response;
  const t = ticket.t;
  const items = itemContext(auth.user.id, story, t, showItemId);
  if (!items.ok) return items.response;
  if (charactersLocked(story, group.memberIds, t.p)) return lockedResponse();
  const blocked = admit(auth.user.id);
  if (blocked) return blocked;

  const members = group.memberIds.map((m) => story.characters.find((c) => c.id === m)!);
  const groupMembers = groupMembersMap({ ...context.groupMembers, [String(group.id)]: group.memberIds });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      // This round's messages: the player's line, then each finished reply.
      const round: TaggedMessage[] = [{ role: "user", content: message, characterId: "", groupId: group.id }];
      try {
        const speakers = await pickSpeakers(story, members, context.history, message);
        for (const speaker of speakers) {
          send({ type: "speaker", characterId: speaker.id });
          let reply = "";
          for await (const delta of chatInGroup(story, speaker, t.p, context.events, [...context.history, ...round], {
            groupWith: members.filter((c) => c.id !== speaker.id),
            privateChat: context.privateChats[speaker.id] ?? [],
            playerName: auth.user.displayName,
            carrying: items.carrying,
            shownItem: items.shownItem,
          })) {
            reply += delta;
            send({ type: "delta", text: delta });
          }
          round.push({ role: "assistant", content: reply, characterId: speaker.id, groupId: group.id });
        }
        send({ type: "replied" });
        send(
          await judgeTurn({
            story,
            ticket: t,
            ticketString: ticket.raw,
            owned: items.owned,
            recent: [...context.recent, ...round].slice(-CONTEXT_LIMITS.recent),
            events: context.events,
            notes: context.notes,
            groupMembers,
          })
        );
      } catch (err) {
        console.error("group chat error", err instanceof Error ? err.message : err);
        // The provider's own error text stays in the server log; players get a plain message.
        send({ type: "error", message: "The reply was interrupted. Please send your message again.", code: "llm_failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: NDJSON_HEADERS });
}
