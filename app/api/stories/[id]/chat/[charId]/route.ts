import { NextResponse } from "next/server";
import { addMessage, getEvents, getGroupMessagesFor, getHistory, getPhaseIndex } from "@/lib/db";
import { chatWithCharacter, MissingApiKeyError } from "@/lib/deepseek";
import { groupMembersOf, judgeTurn } from "@/lib/director";
import { getStory, isUnlocked } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; charId: string }> };

function resolve(id: string, charId: string) {
  const story = getStory(id);
  if (!story) return { error: NextResponse.json({ error: "Story not found" }, { status: 404 }) };
  const character = story.characters.find((c) => c.id === charId);
  if (!character) return { error: NextResponse.json({ error: "Character not found" }, { status: 404 }) };
  const phaseIndex = getPhaseIndex(story.id);
  if (!isUnlocked(story, character, phaseIndex)) {
    return { error: NextResponse.json({ error: "This character is still locked" }, { status: 403 }) };
  }
  return { story, character, phaseIndex };
}

export async function GET(_req: Request, { params }: Params) {
  const { id, charId } = await params;
  const r = resolve(id, charId);
  if ("error" in r) return r.error;
  return NextResponse.json({ messages: getHistory(id, charId) });
}

/**
 * Streams NDJSON lines:
 *   {"type":"delta","text":"..."}            reply tokens
 *   {"type":"replied"}                       reply finished and saved; director is judging
 *   {"type":"done","phaseAdvanced":bool,...} after the director has judged the turn
 *   {"type":"error","message":"..."}
 */
export async function POST(req: Request, { params }: Params) {
  const { id, charId } = await params;
  const r = resolve(id, charId);
  if ("error" in r) return r.error;
  const { story, character, phaseIndex } = r;

  const body = (await req.json().catch(() => ({}))) as { message?: unknown };
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ error: "Message is empty" }, { status: 400 });
  if (!process.env.DEEPSEEK_API_KEY) {
    return NextResponse.json({ error: new MissingApiKeyError().message }, { status: 503 });
  }

  const history = getHistory(id, charId);
  const events = getEvents(id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        let reply = "";
        const context = { groupChats: getGroupMessagesFor(id, charId), groupMembers: groupMembersOf(id) };
        for await (const delta of chatWithCharacter(story, character, phaseIndex, events, history, message, context)) {
          reply += delta;
          send({ type: "delta", text: delta });
        }
        addMessage(id, charId, { role: "user", content: message });
        addMessage(id, charId, { role: "assistant", content: reply });
        send({ type: "replied" });
        send(await judgeTurn(story, phaseIndex, events));
      } catch (err) {
        console.error("chat error", err);
        send({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
