import { NextResponse } from "next/server";
import { listStories, toStorySummary } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    stories: listStories().map(toStorySummary),
    hasApiKey: Boolean(process.env.DEEPSEEK_API_KEY),
  });
}
