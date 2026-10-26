import { NextResponse } from "next/server";
import { createGroup, getPhaseIndex, listGroups } from "@/lib/db";
import type { PublicGroup } from "@/lib/schema";
import { getStory, isUnlocked } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  if (!getStory(id)) return NextResponse.json({ error: "Story not found" }, { status: 404 });
  const groups: PublicGroup[] = listGroups(id).map((g) => ({ id: g.id, memberIds: g.memberIds }));
  return NextResponse.json({ groups });
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { memberIds?: unknown };
  const requested = Array.isArray(body.memberIds) ? body.memberIds.filter((m): m is string => typeof m === "string") : [];
  const memberIds = [...new Set(requested)];
  if (memberIds.length < 2) {
    return NextResponse.json({ error: "Pick at least two characters" }, { status: 400 });
  }
  const phaseIndex = getPhaseIndex(id);
  for (const charId of memberIds) {
    const character = story.characters.find((c) => c.id === charId);
    if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });
    if (!isUnlocked(story, character, phaseIndex)) {
      return NextResponse.json({ error: "This character is still locked" }, { status: 403 });
    }
  }

  const group = createGroup(id, memberIds);
  return NextResponse.json({ group: { id: group.id, memberIds: group.memberIds } satisfies PublicGroup });
}
