import "fake-indexeddb/auto";
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitContext, chatContext, groupContext } from "../lib/save/context";
import { LocalSaveStore } from "../lib/save/local";
import { signTicket } from "../lib/ticket";
import { decodeTicketPayload } from "../lib/ticket-payload";

const S = "story-a";
const t = (r: string, p: number) => signTicket({ uid: 1, sid: S, r, p, f: [] });
let n = 0;
const fresh = () => new LocalSaveStore(1000 + ++n);

describe("LocalSaveStore", () => {
  it("history is oldest first and limited to the newest N", async () => {
    const s = fresh();
    for (let i = 0; i < 5; i++) await s.addMessage(S, "x", { role: i % 2 ? "assistant" : "user", content: `m${i}` });
    await s.addMessage(S, "y", { role: "user", content: "other character" });
    assert.deepEqual((await s.getHistory(S, "x")).map((m) => m.content), ["m0", "m1", "m2", "m3", "m4"]);
    assert.deepEqual((await s.getHistory(S, "x", 2)).map((m) => m.content), ["m3", "m4"]);
    assert.deepEqual(await s.getHistory(S, "nobody"), []);
    assert.equal((await s.getHistory(S, "x"))[1].role, "assistant");
  });

  it("getRecentStoryMessages spans one-on-one chats and groups", async () => {
    const s = fresh();
    const g = await s.createGroup(S, ["a", "b"]);
    await s.addMessage(S, "a", { role: "user", content: "1" });
    await s.addGroupMessage(S, g.id, "", { role: "user", content: "2" });
    await s.addGroupMessage(S, g.id, "b", { role: "assistant", content: "3" });
    await s.addMessage(S, "c", { role: "assistant", content: "4" });
    await s.addMessage("story-b", "a", { role: "user", content: "other story" });
    const all = await s.getRecentStoryMessages(S);
    assert.deepEqual(all.map((m) => m.content), ["1", "2", "3", "4"]);
    assert.deepEqual(all.map((m) => m.groupId), [null, g.id, g.id, null]);
    assert.deepEqual(all.map((m) => m.characterId), ["a", "", "b", "c"]);
    assert.deepEqual((await s.getRecentStoryMessages(S, 2)).map((m) => m.content), ["3", "4"]);
  });

  it("groups: create, get, list; history belongs to the group", async () => {
    const s = fresh();
    const g1 = await s.createGroup(S, ["a", "b"]);
    const g2 = await s.createGroup(S, ["b", "c"]);
    await s.createGroup("story-b", ["a", "b"]);
    assert.notEqual(g1.id, g2.id);
    assert.deepEqual((await s.listGroups(S)).map((g) => g.id), [g1.id, g2.id]);
    assert.deepEqual(await s.getGroup(S, g1.id), { id: g1.id, storyId: S, memberIds: ["a", "b"] });
    assert.equal(await s.getGroup("story-b", g1.id), null);
    assert.equal(await s.getGroup(S, 9999), null);
    await s.addGroupMessage(S, g1.id, "", { role: "user", content: "hello" });
    await s.addGroupMessage(S, g2.id, "", { role: "user", content: "other room" });
    assert.deepEqual((await s.getGroupHistory(S, g1.id)).map((m) => m.content), ["hello"]);
  });

  it("getGroupMessagesFor returns only groups containing the character", async () => {
    const s = fresh();
    const ab = await s.createGroup(S, ["a", "b"]);
    const bc = await s.createGroup(S, ["b", "c"]);
    await s.addGroupMessage(S, ab.id, "", { role: "user", content: "ab-1" });
    await s.addGroupMessage(S, bc.id, "", { role: "user", content: "bc-1" });
    await s.addGroupMessage(S, ab.id, "a", { role: "assistant", content: "ab-2" });
    await s.addMessage(S, "a", { role: "user", content: "private" });
    assert.deepEqual((await s.getGroupMessagesFor(S, "a")).map((m) => m.content), ["ab-1", "ab-2"]);
    assert.deepEqual((await s.getGroupMessagesFor(S, "b")).map((m) => m.content), ["ab-1", "bc-1", "ab-2"]);
    assert.deepEqual((await s.getGroupMessagesFor(S, "c")).map((m) => m.content), ["bc-1"]);
    assert.deepEqual((await s.getGroupMessagesFor(S, "b", 2)).map((m) => m.content), ["bc-1", "ab-2"]);
    assert.deepEqual(await s.getGroupMessagesFor(S, "zed"), []);
  });

  it("events and chapter notes", async () => {
    const s = fresh();
    await s.addEvent(S, 0, "first");
    await s.addEvent(S, 1, "second");
    assert.deepEqual(await s.getEvents(S), ["first", "second"]);
    assert.equal(await s.getChapterNotes(S, 0), "");
    await s.setChapterNotes(S, 0, "notes v1");
    await s.setChapterNotes(S, 0, "notes v2");
    await s.setChapterNotes(S, 1, "ch2");
    assert.equal(await s.getChapterNotes(S, 0), "notes v2");
    assert.equal(await s.getChapterNotes(S, 1), "ch2");
  });

  it("resetStory removes only that story", async () => {
    const s = fresh();
    for (const story of [S, "story-b"]) {
      await s.setTicket(story, signTicket({ uid: 1, sid: story, r: "r", p: 1, f: [] }));
      await s.addMessage(story, "a", { role: "user", content: `msg ${story}` });
      const g = await s.createGroup(story, ["a", "b"]);
      await s.addGroupMessage(story, g.id, "", { role: "user", content: `gmsg ${story}` });
      await s.addEvent(story, 0, `event ${story}`);
      await s.setChapterNotes(story, 0, `notes ${story}`);
    }
    await s.resetStory(S);
    assert.equal(await s.getTicket(S), null);
    assert.deepEqual(await s.getHistory(S, "a"), []);
    assert.deepEqual(await s.listGroups(S), []);
    assert.deepEqual(await s.getEvents(S), []);
    assert.equal(await s.getChapterNotes(S, 0), "");
    assert.deepEqual(await s.getRecentStoryMessages(S), []);
    assert.equal((await s.getHistory("story-b", "a")).length, 1);
    assert.equal((await s.listGroups("story-b")).length, 1);
    assert.deepEqual(await s.getEvents("story-b"), ["event story-b"]);
    assert.equal(await s.getChapterNotes("story-b", 0), "notes story-b");
    assert.ok(await s.getTicket("story-b"));
  });

  it("two user ids are isolated", async () => {
    const a = new LocalSaveStore(501);
    const b = new LocalSaveStore(502);
    await a.addMessage(S, "x", { role: "user", content: "mine" });
    await a.createGroup(S, ["x", "y"]);
    await a.addEvent(S, 0, "e");
    await a.setTicket(S, t("A", 1));
    assert.deepEqual(await b.getHistory(S, "x"), []);
    assert.deepEqual(await b.listGroups(S), []);
    assert.deepEqual(await b.getEvents(S), []);
    assert.equal(await b.getTicket(S), null);
    assert.deepEqual(await b.listProgress(), []);
    assert.equal((await a.listProgress()).length, 1);
  });

  it("setTicket applies preferTicket; progress is read from the ticket", async () => {
    const s = fresh();
    const a1 = t("A", 1);
    const a2 = t("A", 2);
    const b0 = t("B", 0);
    await s.setTicket(S, a1);
    assert.equal(await s.getPhaseIndex(S), 1);
    await s.setTicket(S, a2);
    assert.equal(await s.getTicket(S), a2);
    await s.setTicket(S, a1); // lower p loses
    assert.equal(await s.getTicket(S), a2);
    await s.setTicket(S, b0); // other run: stale reply
    assert.equal(await s.getTicket(S), a2);
    await s.setTicket(S, b0, { force: true }); // restart
    assert.equal(await s.getTicket(S), b0);
    assert.equal(await s.getPhaseIndex(S), 0);
    assert.equal(await s.getPhaseIndex("never-started"), 0);
    const [row] = await s.listProgress();
    assert.equal(row.storyId, S);
    assert.equal(decodeTicketPayload(b0)!.r, "B");
    assert.equal(row.phaseIndex, 0);
  });

  it("concurrent opens share one database (strict mode mounts twice)", async () => {
    const s = fresh();
    await Promise.all([s.addMessage(S, "x", { role: "user", content: "1" }), s.addMessage(S, "x", { role: "user", content: "2" }), s.getTicket(S)]);
    assert.equal((await s.getHistory(S, "x")).length, 2);
  });
});

describe("context", () => {
  it("builds chat and group bodies from the store", async () => {
    const s = fresh();
    const g = await s.createGroup(S, ["a", "b"]);
    await s.setTicket(S, t("A", 1));
    await s.setChapterNotes(S, 1, "ch2 notes");
    await s.addMessage(S, "a", { role: "user", content: "hi a" });
    await s.addGroupMessage(S, g.id, "", { role: "user", content: "hi room" });
    await s.addMessage(S, "b", { role: "user", content: "hi b" });
    const c = await chatContext(s, S, "a");
    assert.equal(c.notes, "ch2 notes");
    assert.deepEqual(c.history, [{ role: "user", content: "hi a" }]);
    assert.deepEqual(c.groupChats.map((m) => m.content), ["hi room"]);
    assert.deepEqual(c.groupMembers, { [String(g.id)]: ["a", "b"] });
    const gc = await groupContext(s, S, g);
    assert.deepEqual(gc.history.map((m) => m.content), ["hi room"]);
    assert.deepEqual(Object.keys(gc.privateChats).sort(), ["a", "b"]);
    assert.deepEqual(gc.privateChats.b, [{ role: "user", content: "hi b" }]);
  });

  it("fitContext truncates content and drops the oldest entries under the byte cap", () => {
    const big = "x".repeat(6_000);
    const msg = (i: number) => ({ role: "user" as const, content: `${i}:${big}`, characterId: "a", groupId: null });
    const ctx = {
      recent: Array.from({ length: 30 }, (_, i) => msg(i)),
      events: [],
      notes: "",
      groupMembers: {},
      history: Array.from({ length: 20 }, (_, i) => ({ role: "user" as const, content: "y".repeat(7000) + i })),
      groupChats: Array.from({ length: 20 }, (_, i) => msg(100 + i)),
    };
    const fit = fitContext(ctx);
    assert.ok(new TextEncoder().encode(JSON.stringify(fit)).length < 240_000);
    assert.ok(fit.history.every((m) => m.content.length <= 6000));
    // newest entries survive
    assert.ok(fit.recent[fit.recent.length - 1].content.startsWith("29:"));
    assert.ok(fit.recent.length < 30 || fit.groupChats.length < 20 || fit.history.length < 20);
    // input untouched
    assert.equal(ctx.recent.length, 30);
  });
});
