import { RequestCodeBodySchema } from "@/lib/api-schemas";
import { requestCode } from "@/lib/auth";
import { checkOrigin, clientIp, jsonError, readJsonBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const raw = await readJsonBody(req, 4_000);
  if (!raw.ok) return raw.response;
  const parsed = RequestCodeBodySchema.safeParse(raw.body);
  if (!parsed.success) return jsonError(400, "bad_request", "Enter a valid email address.");

  const res = await requestCode(parsed.data.email, clientIp(req));
  if (res.ok) return Response.json({ ok: true });
  if (res.code === "rate_limited") {
    return jsonError(429, "rate_limited", "Please wait a moment before asking for another code.", {
      retryAfter: res.retryAfter,
    });
  }
  if (res.code === "mail_unavailable") {
    return jsonError(503, "mail_unavailable", "We could not send the email right now. Please try again later.");
  }
  return jsonError(400, "bad_request", "Enter a valid email address.");
}
