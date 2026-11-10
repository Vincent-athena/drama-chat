import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

/** Liveness + database check for the container healthcheck. No auth, reveals nothing else. */
export async function GET() {
  try {
    db().prepare("SELECT 1").get();
    return Response.json({ ok: true, db: true }, { headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
