import { getSessionUser, isAdminEmail } from "@/lib/auth";
import { hasApiKey } from "@/lib/llm";
import { listStoriesFor } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = getSessionUser(req)?.user;
  return Response.json({ stories: listStoriesFor(!!user && isAdminEmail(user.email)), hasApiKey: hasApiKey() });
}
