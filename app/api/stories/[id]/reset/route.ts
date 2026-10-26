import { NextResponse } from "next/server";
import { resetStory } from "@/lib/db";
import { getStory } from "@/lib/stories";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getStory(id)) return NextResponse.json({ error: "Story not found" }, { status: 404 });
  resetStory(id);
  return NextResponse.json({ ok: true });
}
