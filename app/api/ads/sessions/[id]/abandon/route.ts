import { abandonAdSession } from "@/lib/ads";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Idempotent: only the caller's own started session changes; the answer is always ok. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const { id } = await params;
  abandonAdSession(auth.user.id, id);
  return Response.json({ ok: true });
}
