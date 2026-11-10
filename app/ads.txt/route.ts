import { googlePublisherId } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // read the env at request time, not at build

/** Authorised-seller file Google checks. f08c47fec0942fa0 is Google's fixed certification authority id. */
export async function GET() {
  const id = googlePublisherId();
  if (!id) return new Response("Not found", { status: 404 });
  return new Response(`google.com, ${id}, DIRECT, f08c47fec0942fa0\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
