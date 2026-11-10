import { VerifyBodySchema } from "@/lib/api-schemas";
import { sessionCookie, verifyCode } from "@/lib/auth";
import { checkOrigin, jsonError, readJsonBody } from "@/lib/http";
import { meResponse } from "@/lib/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WRONG = "That code is wrong or has expired.";

export async function POST(req: Request) {
  const bad = checkOrigin(req);
  if (bad) return bad;
  const raw = await readJsonBody(req, 4_000);
  if (!raw.ok) return raw.response;
  const parsed = VerifyBodySchema.safeParse(raw.body);
  if (!parsed.success) return jsonError(400, "invalid_code", WRONG);

  const res = verifyCode(parsed.data.email, parsed.data.code, req.headers.get("user-agent") ?? "");
  if (!res.ok) return jsonError(400, "invalid_code", WRONG);
  const out = Response.json(meResponse(res.user));
  out.headers.append("Set-Cookie", sessionCookie(res.token));
  return out;
}
