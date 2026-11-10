import type { ErrorCode } from "./api-types";
import { appOrigin } from "./env";
import { CONTEXT_LIMITS } from "./limits-shared";

export function jsonError(status: number, code: ErrorCode, error: string, extra?: object): Response {
  return Response.json({ code, error, ...extra }, { status });
}

/** Reads the body once, enforces the byte cap (413) and parses JSON (400). */
export async function readJsonBody(
  req: Request,
  maxBytes: number = CONTEXT_LIMITS.bodyBytes
): Promise<{ ok: true; body: unknown } | { ok: false; response: Response }> {
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) {
    return { ok: false, response: jsonError(413, "too_large", "That request is too large.") };
  }
  try {
    return { ok: true, body: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false, response: jsonError(400, "bad_request", "The request body is not valid JSON.") };
  }
}

/** null = ok. GET/HEAD pass; anything else needs a same-origin Origin header. */
export function checkOrigin(req: Request): Response | null {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const fail = () => jsonError(403, "bad_origin", "This request did not come from the app.");
  const origin = req.headers.get("origin");
  if (!origin) return fail();
  const configured = appOrigin();
  if (configured) return origin === configured ? null : fail();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return host && new URL(origin).host === host ? null : fail();
  } catch {
    return fail();
  }
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
