import { NextResponse } from "next/server";
import { getStory, toPublicStory } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const story = getStory(id);
  if (!story) return NextResponse.json({ error: "Story not found" }, { status: 404 });
  return NextResponse.json({ story: toPublicStory(story), hasApiKey: Boolean(process.env.DEEPSEEK_API_KEY) });
}
