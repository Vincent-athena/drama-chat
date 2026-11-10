import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GenerateStreamEvent } from "../lib/api-types";
import { streamGeneration } from "../lib/generation-stream";
import type { Story } from "../lib/schema";

const story = { id: "s" } as unknown as Story;
async function events(stream: ReadableStream<Uint8Array>): Promise<GenerateStreamEvent[]> {
  const text = await new Response(stream).text();
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("streamGeneration", () => {
  it("sends progress in order, then done with the saved id", async () => {
    const out = await events(
      streamGeneration(
        async (p) => {
          p({ stage: "outline", attempt: 1 });
          p({ stage: "characters", done: 0, total: 6 });
          p({ stage: "characters", done: 3, total: 6 });
          p({ stage: "assembly" });
          return story;
        },
        () => "saved-id"
      )
    );
    assert.deepEqual(out, [
      { type: "progress", stage: "outline", attempt: 1 },
      { type: "progress", stage: "characters", done: 0, total: 6 },
      { type: "progress", stage: "characters", done: 3, total: 6 },
      { type: "progress", stage: "assembly" },
      { type: "done", id: "saved-id" },
    ]);
  });

  it("sends a generic error event when generation throws, without leaking the message", async () => {
    const log = console.error;
    console.error = () => {};
    try {
      const out = await events(streamGeneration(async () => { throw new Error("secret detail"); }, () => "x"));
      assert.deepEqual(out, [{ type: "error", message: "Story generation failed. Please try again." }]);
    } finally { console.error = log; }
  });

  it("sends an error event when saving throws", async () => {
    const log = console.error;
    console.error = () => {};
    try {
      const out = await events(streamGeneration(async () => story, () => { throw new Error("disk"); }));
      assert.equal(out.at(-1)?.type, "error");
    } finally { console.error = log; }
  });

  it("pings while nothing else is sent", async () => {
    const out = await events(
      streamGeneration(async () => { await new Promise((r) => setTimeout(r, 120)); return story; }, () => "id", { pingMs: 20 })
    );
    assert.ok(out.some((e) => e.type === "ping"));
    assert.deepEqual(out.at(-1), { type: "done", id: "id" });
  });
});
