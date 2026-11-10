import { hasApiKey } from "@/lib/llm";
import { listStories, toStorySummary } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ stories: listStories().map(toStorySummary), hasApiKey: hasApiKey() });
}
