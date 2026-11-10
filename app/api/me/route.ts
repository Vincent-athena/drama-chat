import { DeleteAccountSchema, ProfilePatchSchema } from "@/lib/api-schemas";
import { clearSessionCookie, deleteAccount, getSessionUser, requireUser, updateProfile } from "@/lib/auth";
import { jsonError, readJsonBody } from "@/lib/http";
import { meResponse } from "@/lib/me";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Never 401: guests get `user: null`. */
export async function GET(req: Request) {
  const s = getSessionUser(req);
  return Response.json(meResponse(s?.user ?? null));
}

export async function PATCH(req: Request) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const raw = await readJsonBody(req, 4_000);
  if (!raw.ok) return raw.response;
  const parsed = ProfilePatchSchema.safeParse(raw.body);
  if (!parsed.success) {
    return jsonError(400, "bad_request", "Use a name of 1 to 40 characters without < or >, and an emoji from the list.");
  }
  const user = updateProfile(auth.user.id, parsed.data);
  return Response.json(meResponse(user));
}

export async function DELETE(req: Request) {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth.response;
  const raw = await readJsonBody(req, 4_000);
  if (!raw.ok) return raw.response;
  const parsed = DeleteAccountSchema.safeParse(raw.body);
  if (!parsed.success || parsed.data.confirmEmail.trim().toLowerCase() !== auth.user.email.toLowerCase()) {
    return jsonError(400, "bad_request", "Type your email exactly to confirm.");
  }
  deleteAccount(auth.user.id);
  const out = Response.json({ ok: true });
  out.headers.append("Set-Cookie", clearSessionCookie());
  return out;
}
