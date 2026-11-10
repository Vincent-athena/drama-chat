import { GenerateBodySchema } from "@/lib/api-schemas";
import { requireAdmin } from "@/lib/auth";
import { jsonError, readJsonBody } from "@/lib/http";
import { generateStory, hasApiKey, MissingApiKeyError } from "@/lib/llm";
import { saveStory } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  try {
    const story = await generateStory(premise, {
      numPhases: clamp(body.numPhases, 2, 8, 4),
      numCharacters: clamp(body.numCharacters, 3, 12, 6),
    });
    const id = saveStory(story);
    return Response.json({ id });
  } catch (err) {
    const status = err instanceof MissingApiKeyError ? 503 : 502;
    const code = err instanceof MissingApiKeyError ? "no_api_key" : "llm_failed";
    return jsonError(status, code, err instanceof Error ? err.message : "Generation failed");
  }
}
