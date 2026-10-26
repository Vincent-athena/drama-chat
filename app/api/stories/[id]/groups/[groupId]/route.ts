import { NextResponse } from "next/server";
import {
  addGroupMessage,
  getEvents,
  getGroup,
  getGroupHistory,
  getHistory,
  getPhaseIndex,
  type TaggedMessage,
} from "@/lib/db";
import { chatInGroup, MissingApiKeyError, pickSpeakers } from "@/lib/deepseek";
import { judgeTurn } from "@/lib/director";
import type { GroupChatMessage, PublicGroup } from "@/lib/schema";
import { getStory, isUnlocked } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; groupId: string }> };

const PRIVATE_CHAT_WINDOW = 20;

function resolve(id: string, groupId: string) {
  const story = getStory(id);
  if (!story) return { error: NextResponse.json({ error: "Story not found" }, { status: 404 }) };
  const group = getGroup(id, Number(groupId));
  if (!group) return { error: NextResponse.json({ error: "Group chat not found" }, { status: 404 }) };
  const phaseIndex = getPhaseIndex(story.id);
  const members = group.memberIds
    .map((charId) => story.characters.find((c) => c.id === charId))
    .filter((c) => c !== undefined);
  if (members.length !== group.memberIds.length || members.some((c) => !isUnlocked(story, c, phaseIndex))) {
    return { error: NextResponse.json({ error: "This group includes a locked character" }, { status: 403 }) };
  }
  return { story, group, members, phaseIndex };
}

export async function GET(_req: Request, { params }: Params) {
  const { id, groupId } = await params;
  const r = resolve(id, groupId);
  if ("error" in r) return r.error;
  const messages: GroupChatMessage[] = getGroupHistory(r.group.id).map(({ role, content, characterId }) => ({
    role,
    content,
    characterId,
  }));
  return NextResponse.json({ group: { id: r.group.id, memberIds: r.group.memberIds } satisfies PublicGroup, messages });
}

/**
 * Streams NDJSON lines:
 *   {"type":"speaker","characterId":"..."}   a character starts replying
 *   {"type":"delta","text":"..."}            that character's reply tokens
 *   {"type":"replied"}                       every reply finished and saved; director is judging
 *   {"type":"done","phaseAdvanced":bool,...} after the director has judged the turn
 *   {"type":"error","message":"...","saved":bool}   saved: whether the replies so far were kept
 */
export async function POST(req: Request, { params }: Params) {
  const { id, groupId } = await params;
  const r = resolve(id, groupId);
  if ("error" in r) return r.error;
  const { story, group, members, phaseIndex } = r;

  const body = (await req.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Message is empty" }, { status: 400 });
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: new MissingApiKeyError().message }, { status: 503 });
  }

  const history = getGroupHistory(group.id);
  const events = getEvents(id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      // This round's messages: the player's line, then each finished reply.
      const round: TaggedMessage[] = [{ role: "user", content: message, characterId: "", groupId: group.id }];
      try {
        const speakers = await pickSpeakers(story, members, history, message);
        try {
          for (const speaker of speakers) {
            send({ type: "speaker", characterId: speaker.id });
            let reply = "";
            for await (const delta of chatInGroup(story, speaker, phaseIndex, events, [...history, ...round], {
              groupWith: members.filter((c) => c.id !== speaker.id),
              privateChat: getHistory(id, speaker.id).slice(-PRIVATE_CHAT_WINDOW),
            })) {
              reply += delta;
              send({ type: "delta", text: delta });
            }
            round.push({ role: "assistant", content: reply, characterId: speaker.id, groupId: group.id });
          }
        } finally {
          // Keep the round if anyone answered, so a failure mid-round loses nothing that was said.
          if (round.length > 1) {
            for (const m of round) addGroupMessage(id, group.id, m.characterId, { role: m.role, content: m.content });
          }
        }
        send({ type: "replied" });
        send(await judgeTurn(story, phaseIndex, events));
      } catch (err) {
        console.error("group chat error", err);
        send({ type: "error", message: err instanceof Error ? err.message : "Unknown error", saved: round.length > 1 });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
