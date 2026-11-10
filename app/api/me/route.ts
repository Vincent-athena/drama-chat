import { getSessionUser } from "@/lib/auth";
import { meResponse } from "@/lib/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Never 401: guests get `user: null`. */
export async function GET(req: Request) {
  const s = getSessionUser(req);
  return Response.json(meResponse(s?.user ?? null));
}
