import { clearSessionCookie, signOutRequest } from "@/lib/auth";
import { checkOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Works without a session: it just clears the cookie. */
export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  signOutRequest(req);
  const out = Response.json({ ok: true });
  out.headers.append("Set-Cookie", clearSessionCookie());
  return out;
}
