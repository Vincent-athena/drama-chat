import type { GenerateProgress, GenerateStreamEvent } from "./api-types";
import type { Story } from "./schema";

export const GENERATE_PING_MS = 15_000;
export const GENERATE_FAILED_MESSAGE = "Story generation failed. Please try again.";

/**
 * Runs a story generation and reports it as an NDJSON stream: progress events, a ping every 15 s while nothing
 * else was sent (so Cloudflare does not drop the idle connection), then `done` or `error`.
 */
export function streamGeneration(
  generate: (onProgress: (p: GenerateProgress) => void) => Promise<Story>,
  save: (story: Story) => string,
  opts: { pingMs?: number } = {}
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const pingMs = opts.pingMs ?? GENERATE_PING_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let quiet = true;
      const send = (evt: GenerateStreamEvent) => {
        if (closed) return;
        quiet = false;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(evt) + "\n"));
        } catch {
          closed = true;
        }
      };
      timer = setInterval(() => {
        if (quiet) send({ type: "ping" });
        quiet = true;
      }, pingMs);
      try {
        const story = await generate((p) => send({ type: "progress", ...p }));
        send({ type: "done", id: save(story) });
      } catch (err) {
        console.error("Story generation failed:", err instanceof Error ? err.message : String(err));
        send({ type: "error", message: GENERATE_FAILED_MESSAGE });
      } finally {
        clearInterval(timer);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        }
      }
    },
    cancel() {
      closed = true;
      clearInterval(timer);
    },
  });
}
