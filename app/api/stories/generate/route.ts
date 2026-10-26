import { NextResponse } from "next/server";
import { generateStory, MissingApiKeyError } from "@/lib/deepseek";
import { saveStory } from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    premise?: unknown;
    numPhases?: unknown;
    numCharacters?: unknown;
  };
  const premise = typeof body.premise === "string" ? body.premise.trim().slice(0, 2000) : "";
  const clamp = (v: unknown, lo: number, hi: number, d: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d;

  try {
    const story = await generateStory(premise, {
      numPhases: clamp(body.numPhases, 2, 8, 4),
      numCharacters: clamp(body.numCharacters, 3, 12, 6),
    });
    const id = saveStory(story);
    return NextResponse.json({ id });
  } catch (err) {
    const status = err instanceof MissingApiKeyError ? 503 : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Generation failed" }, { status });
  }
}
