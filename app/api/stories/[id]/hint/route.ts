import { NextResponse } from "next/server";
import { getChapterNotes, getPhaseIndex, getRecentStoryMessages } from "@/lib/db";
import { generateHint } from "@/lib/deepseek";
import { groupMembersOf } from "@/lib/director";
import type { HintLevel } from "@/lib/prompts";
import { getStory, isUnlocked } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Body: {"level": 1 | 2 | 3}, from a gentle nudge to a direct walkthrough. Returns {"hint": "..."}. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });
  const phaseIndex = getPhaseIndex(id);
  if (phaseIndex >= story.phases.length) {
    return NextResponse.json({ error: "The story is finished" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { level?: unknown };
  const level = ([1, 2, 3] as const).find((l) => l === body.level) ?? 1;
  const authorHint = story.phases[phaseIndex].hint;
  if (!process.env.DEEPSEEK_API_KEY) {
    return authorHint
      ? NextResponse.json({ hint: authorHint })
      : NextResponse.json({ error: "Hints need a DeepSeek API key. Run `npm run setup`." }, { status: 503 });
  }

  try {
    const hint = await generateHint(
      story,
      phaseIndex,
      story.characters.filter((c) => isUnlocked(story, c, phaseIndex)),
      getChapterNotes(id, phaseIndex),
      getRecentStoryMessages(id),
      level as HintLevel,
      groupMembersOf(id)
    );
    return NextResponse.json({ hint });
  } catch (err) {
    console.error("hint error", err);
    // Fall back to the author's hint rather than leaving the player with nothing.
    if (authorHint) return NextResponse.json({ hint: authorHint });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not get a hint" }, { status: 502 });
  }
}
