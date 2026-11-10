import { requireUser } from "@/lib/auth";
import { jsonError } from "@/lib/http";
import { getStory } from "@/lib/stories";
import { freshTicket } from "@/lib/ticket";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The server holds no save; a restart is a fresh ticket with a new run id. The browser clears its own data. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const story = getStory(id);
  if (!story) return jsonError(404, "not_found", "Story not found");
  return Response.json({ ticket: freshTicket(auth.user.id, story.id) });
}
