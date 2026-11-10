import { GenerateBodySchema } from "@/lib/api-schemas";
import { requireAdmin } from "@/lib/auth";
import { streamGeneration } from "@/lib/generation-stream";
import { jsonError, readJsonBody } from "@/lib/http";
import { generateStory, hasApiKey, MissingApiKeyError } from "@/lib/llm";
import { saveStory } from "@/lib/stories";
import { NDJSON_HEADERS } from "@/lib/turn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Answers with an NDJSON stream (progress, ping, then done or error) so the connection is never idle for long:
 * Cloudflare drops a request that sends nothing for about 100 s. Checks run first and answer with plain JSON errors.
 */
export async function POST(req: Request) {
  const auth = requireAdmin(req);
  if (!auth.ok) return auth.response;
  const raw = await readJsonBody(req, 20_000);
  if (!raw.ok) return raw.response;
  const parsed = GenerateBodySchema.safeParse(raw.body);
  if (!parsed.success) return jsonError(400, "bad_request", "Invalid request.");
  const body = parsed.data;
  if (!hasApiKey()) return jsonError(503, "no_api_key", new MissingApiKeyError().message);

  const premise = (body.premise ?? "").trim().slice(0, 2000);
  const clamp = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;
  const numPhases = clamp(body.numPhases, 2, 8, 4);
  const numCharacters = clamp(body.numCharacters, 3, 12, 6);

  const stream = streamGeneration(
    (onProgress) => generateStory(premise, { numPhases, numCharacters, onProgress }),
    saveStory
  );
  return new Response(stream, { headers: NDJSON_HEADERS });
}
