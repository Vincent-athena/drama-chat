import { clearSessionCookie, deleteAllSessions, listSessions, requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = requireUser(req);
  if (!auth.ok) return auth.response;
  return Response.json({ sessions: listSessions(auth.user.id, auth.sessionId) });
}

/** Signs out every device, this one included. */
export async function DELETE(req: Request) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  deleteAllSessions(auth.user.id);
  const out = Response.json({ ok: true });
  out.headers.append("Set-Cookie", clearSessionCookie());
  return out;
}
