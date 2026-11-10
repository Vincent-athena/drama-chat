process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { judgeTurn } from "../lib/director";
import { StorySchema, type JudgeResult } from "../lib/schema";
import { freshTicket, verifyTicket } from "../lib/ticket";
import { decodeTicketPayload } from "../lib/ticket-payload";
import { charactersUnlockedAt } from "../lib/stories";

const story = StorySchema.parse(JSON.parse(readFileSync(join(__dirname, "..", "stories", "sample-midnight-manor.json"), "utf8")));
const payloadAt = (p: number) => ({ ...decodeTicketPayload(freshTicket(1, story.id))!, p });
const base = { story, recent: [], events: [], notes: "", groupMembers: new Map<number, string[]>() };
const verdict = (v: Partial<JudgeResult>) => async (): Promise<JudgeResult> => ({
  completed: false, reason: "", eventSummary: "", notes: "", ...v,
});

describe("judgeTurn", () => {
  it("not completed: same progress, notes returned", async () => {
    const t = payloadAt(0);
    const d = await judgeTurn({ ...base, ticket: t }, verdict({ notes: "  met the butler  " }));
    assert.equal(d.phaseAdvanced, false);
    assert.equal(d.notes, "met the butler");
    assert.equal(d.phaseIndex, 0);
    assert.deepEqual(d.itemsFound, []);
    assert.equal(verifyTicket(d.ticket, 1, story).p, 0);
    assert.equal(decodeTicketPayload(d.ticket)!.r, t.r);
  });

  it("echoes the given ticket string unchanged when nothing changed", async () => {
    const raw = freshTicket(1, story.id);
    const d = await judgeTurn({ ...base, ticket: decodeTicketPayload(raw)!, ticketString: raw }, verdict({}));
    assert.equal(d.ticket, raw);
  });

  it("empty notes become null (keep the old ones)", async () => {
    const d = await judgeTurn({ ...base, ticket: payloadAt(0) }, verdict({ notes: "   " }));
    assert.equal(d.notes, null);
  });

  it("completed: ticket p+1, event summary fallback, unlocked list", async () => {
    const d = await judgeTurn({ ...base, ticket: payloadAt(0) }, verdict({ completed: true, notes: "n" }));
    assert.equal(d.phaseAdvanced, true);
    assert.equal(d.phaseIndex, 0);
    assert.equal(verifyTicket(d.ticket, 1, story).p, 1);
    assert.equal(d.eventSummary, `${story.phases[0].title} was resolved.`);
    assert.equal(d.completedPhaseTitle, story.phases[0].title);
    assert.deepEqual(d.unlocked, charactersUnlockedAt(story, 1).map((c) => ({ id: c.id, name: c.name, avatarEmoji: c.avatarEmoji })));
    assert.equal(d.newPhase?.title, story.phases[1].title);
    assert.equal(d.finished, false);

    const given = await judgeTurn({ ...base, ticket: payloadAt(0) }, verdict({ completed: true, eventSummary: "The cellar opened." }));
    assert.equal(given.eventSummary, "The cellar opened.");
  });

  it("completing the last chapter finishes the story", async () => {
    const last = story.phases.length - 1;
    const d = await judgeTurn({ ...base, ticket: payloadAt(last) }, verdict({ completed: true }));
    assert.equal(d.finished, true);
    assert.equal(d.newPhase, null);
    assert.equal(verifyTicket(d.ticket, 1, story).p, story.phases.length);
  });

  it("a finished story makes no judge call", async () => {
    let calls = 0;
    const d = await judgeTurn({ ...base, ticket: payloadAt(story.phases.length) }, async () => {
      calls++;
      return { completed: true, reason: "", eventSummary: "", notes: "x" };
    });
    assert.equal(calls, 0);
    assert.equal(d.phaseAdvanced, false);
    assert.equal(d.notes, null);
    assert.equal(d.phaseIndex, story.phases.length);
  });
});
