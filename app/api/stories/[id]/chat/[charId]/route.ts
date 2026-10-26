import { NextResponse } from "next/server";
import {
  addEvent,
  addMessage,
  getEvents,
  getHistory,
  getPhaseIndex,
  getRecentStoryMessages,
  setPhaseIndex,
} from "@/lib/db";
import { chatWithCharacter, judgePhase, MissingApiKeyError } from "@/lib/deepseek";
import { charactersUnlockedAt, getStory, isUnlocked } from "@/lib/stories";

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
        for await (const delta of chatWithCharacter(story, character, phaseIndex, events, history, message)) {
          reply += delta;
          send({ type: "delta", text: delta });
        }
        addMessage(id, charId, { role: "user", content: message });
        addMessage(id, charId, { role: "assistant", content: reply });
        send({ type: "replied" });

        const finished = phaseIndex >= story.phases.length;
        if (finished) {
          send({ type: "done", phaseAdvanced: false });
          return;
        }

        const verdict = await judgePhase(story, phaseIndex, getRecentStoryMessages(id), events);
        // Another request may have advanced the phase while this one was streaming.
        if (verdict.completed && getPhaseIndex(id) === phaseIndex) {
          const next = phaseIndex + 1;
          addEvent(id, phaseIndex, verdict.eventSummary || `${story.phases[phaseIndex].title} was resolved.`);
          setPhaseIndex(id, next);
          const nextPhase = story.phases[next];
          send({
            type: "done",
            phaseAdvanced: true,
            completedPhaseTitle: story.phases[phaseIndex].title,
            eventSummary: verdict.eventSummary,
            finished: !nextPhase,
            newPhase: nextPhase
              ? { title: nextPhase.title, narration: nextPhase.narration, objective: nextPhase.objective }
              : null,
            unlocked: nextPhase
              ? charactersUnlockedAt(story, next).map((c) => ({ id: c.id, name: c.name, avatarEmoji: c.avatarEmoji }))
              : [],
          });
        } else {
          send({ type: "done", phaseAdvanced: false });
        }
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
