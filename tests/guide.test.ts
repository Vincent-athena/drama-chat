import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "drama-guide-"));
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
process.env.DAY_TZ = "Asia/Ho_Chi_Minh";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.DEEPSEEK_API_KEY = "sk-test-not-real";
process.env.DEEPSEEK_BASE_URL = "http://llm.invalid";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, it } from "node:test";
import { completeAdSession, startAdSession } from "../lib/ads";
import { SESSION_COOKIE, requestCode, verifyCode } from "../lib/auth";
import { db } from "../lib/db";
import { nextDayStart } from "../lib/day";
import { guideQuota, runGuide } from "../lib/guide";
import { peek } from "../lib/limits";
import { advanceGuidePrompt } from "../lib/prompts";
import { StorySchema, AdvanceGuideSchema, type AdvanceGuide, type Story } from "../lib/schema";
import { freshTicket, signTicket } from "../lib/ticket";
import { saveFileOk } from "./guide-helpers";
import { POST as guidePOST } from "../app/api/stories/[id]/guide/route";
import { GET as meGET } from "../app/api/me/route";

const manor: Story = StorySchema.parse(JSON.parse(readFileSync(join(__dirname, "..", "stories", "sample-midnight-manor.json"), "utf8")));
const SID = manor.id;
const T0 = Date.UTC(2026, 5, 10, 5, 0, 0); // 12:00 in Ho Chi Minh
const G: AdvanceGuide = { diagnosis: "d", steps: [{ character: "c", action: "a", say: "s" }] };
const ok = async () => G;
const boom = async (): Promise<AdvanceGuide> => { throw new Error("model down"); };
const freeKey = (uid: number, key = "2026-06-10") => `guide_free:${uid}:${key}`;

let n = 0;
async function newUser() {
  const email = `guide${n++}@example.com`;
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try { await requestCode(email, "ip-" + email, Date.now()); } finally { console.log = orig; }
  const r = verifyCode(email, /: (\d{6})/.exec(lines.join(""))![1], "UA");
  if (!r.ok) throw new Error("no login");
  return { id: r.user.id, cookie: `${SESSION_COOKIE}=${r.token}` };
}
function giveCredit(uid: number, now: number) {
  const s = startAdSession(uid, { rewardType: "guide", storyId: SID }, { story: manor, ticket: null }, now);
  assert.ok(s.ok);
  assert.ok(completeAdSession(uid, s.session.id, now + 15_000).ok);
}

describe("runGuide", () => {
  it("the first guide of the day is free, the second is 402 needs_ad with the next local midnight", async () => {
    const u = await newUser();
    assert.deepEqual(guideQuota(u.id, T0), { freeLeftToday: 1, credits: 0, resetsAt: nextDayStart(T0) });
    const first = await runGuide(u.id, ok, T0);
    assert.ok(first.ok && first.source === "free" && first.quota.freeLeftToday === 0);
    const second = await runGuide(u.id, ok, T0 + 1000);
    assert.deepEqual(second, { ok: false, status: 402, code: "needs_ad", resetsAt: nextDayStart(T0) });
    assert.equal(nextDayStart(T0), Date.UTC(2026, 5, 10, 17, 0, 0));
  });

  it("one guide ad buys exactly one guide", async () => {
    const u = await newUser();
    await runGuide(u.id, ok, T0);
    giveCredit(u.id, T0);
    const bought = await runGuide(u.id, ok, T0 + 60_000);
    assert.ok(bought.ok && bought.source === "credit" && bought.quota.credits === 0);
    const again = await runGuide(u.id, ok, T0 + 61_000);
    assert.ok(!again.ok && again.code === "needs_ad");
  });

  it("free uses come before credits", async () => {
    const u = await newUser();
    giveCredit(u.id, T0);
    const r = await runGuide(u.id, ok, T0 + 60_000);
    assert.ok(r.ok && r.source === "free" && r.quota.credits === 1);
  });

  it("a failing generator consumes nothing (free use and credit)", async () => {
    const u = await newUser();
    const f = await runGuide(u.id, boom, T0);
    assert.deepEqual(f, { ok: false, status: 502, code: "llm_failed" });
    assert.equal(peek(freeKey(u.id), T0), 0);
    assert.equal(guideQuota(u.id, T0).freeLeftToday, 1);
    await runGuide(u.id, ok, T0);
    giveCredit(u.id, T0);
    await runGuide(u.id, boom, T0 + 60_000);
    assert.equal(guideQuota(u.id, T0 + 60_000).credits, 1);
    assert.equal((db().prepare("SELECT COUNT(*) AS c FROM ad_sessions WHERE user_id = ? AND redeemed_at IS NOT NULL").get(u.id) as { c: number }).c, 0);
  });

  it("the free guide is back after the next local midnight", async () => {
    const u = await newUser();
    await runGuide(u.id, ok, T0);
    assert.ok(!(await runGuide(u.id, ok, nextDayStart(T0) - 1)).ok);
    const next = await runGuide(u.id, ok, nextDayStart(T0));
    assert.ok(next.ok && next.source === "free");
  });

  it("two parallel runs with one free use: one ok, one 402; the guide of the loser is discarded", async () => {
    const u = await newUser();
    const [a, b] = await Promise.all([runGuide(u.id, ok, T0), runGuide(u.id, ok, T0)]);
    assert.equal([a, b].filter((r) => r.ok).length, 1);
    const lost = [a, b].find((r) => !r.ok)!;
    assert.ok(!lost.ok && lost.status === 402 && lost.code === "needs_ad");
    assert.equal(peek(freeKey(u.id), T0), 1);
  });

  it("two parallel runs with one credit and no free use: one ok", async () => {
    const u = await newUser();
    await runGuide(u.id, ok, T0);
    giveCredit(u.id, T0);
    const [a, b] = await Promise.all([runGuide(u.id, ok, T0 + 60_000), runGuide(u.id, ok, T0 + 60_000)]);
    assert.equal([a, b].filter((r) => r.ok).length, 1);
  });
});

describe("guide route and prompt", () => {
  const H = { origin: "http://localhost:3000", host: "localhost:3000" };
  const ctx = { recent: [], events: [], notes: "", groupMembers: {} };
  const params = { params: Promise.resolve({ id: SID }) };
  const post = (cookie: string, ticket: string | null, body: unknown) =>
    new Request(`http://localhost:3000/api/stories/${SID}/guide`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, ...H, ...(ticket ? { "x-save-ticket": ticket } : {}) },
      body: JSON.stringify(body),
    });
  const realFetch = globalThis.fetch;
  // The OpenAI client keeps the first fetch it sees, so install one dispatcher and swap the handler.
  let handler: (init?: { body?: string }) => Response = () => new Response("{}", { status: 500 });
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => handler(init)) as typeof fetch;
  after(() => { globalThis.fetch = realFetch; });

  it("the prompt keeps criteria server-side: it contains them, tells the model not to quote, and names how to get missing items", () => {
    const text = advanceGuidePrompt(manor, 2, manor.characters, [], [], "", undefined, new Set(["gala-invitation"]));
    assert.ok(text.includes(manor.phases[2].completionCriteria));
    assert.match(text, /do not quote them/);
    assert.match(text, /Items the player carries: .*Gala invitation/);
    assert.match(text, /Still missing[^\n]*\n- .*Solicitor's carbon copy: can be unlocked with an ad/);
    const none = advanceGuidePrompt(manor, 0, manor.characters, [], [], "", undefined, new Set());
    assert.doesNotMatch(none, /Still missing/);
  });

  it("the route answers with only the model JSON, quota and source; the prompt reached the model, the criteria did not reach the response", async () => {
    const u = await newUser();
    let sent = "";
    handler = (init) => {
      sent = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: "x", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(G) } }] }), { headers: { "content-type": "application/json" } });
    };
    const ticket = signTicket({ uid: u.id, sid: SID, r: "r", p: 2, f: [] });
    const res = await guidePOST(post(u.cookie, ticket, { context: ctx }), params);
    assert.equal(res.status, 200, sent);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.deepEqual(Object.keys(body).sort(), ["guide", "quota", "source"]);
    assert.equal(body.source, "free");
    assert.deepEqual(AdvanceGuideSchema.parse(body.guide), G);
    for (const p of manor.phases) assert.ok(!text.includes(p.completionCriteria));
    for (const i of manor.items) if (i.obtainCriteria) assert.ok(!text.includes(i.obtainCriteria));
    assert.ok(sent.includes(manor.phases[2].completionCriteria.slice(0, 40)), "criteria are in the server-side prompt");
    // second call: 402 and the model is not called
    sent = "";
    const second = await guidePOST(post(u.cookie, ticket, { context: ctx }), params);
    assert.equal(second.status, 402);
    const sb = await second.json();
    assert.equal(sb.code, "needs_ad");
    assert.ok(typeof sb.resetsAt === "number");
    assert.equal(sent, "");
  });

  it("route validation: no ticket 400, bad body 400, finished story 400, failed model 502 without consuming", async () => {
    const u = await newUser();
    const ticket = signTicket({ uid: u.id, sid: SID, r: "r", p: 0, f: [] });
    assert.equal((await guidePOST(post(u.cookie, null, { context: ctx }), params)).status, 400);
    assert.equal((await guidePOST(post(u.cookie, ticket, { context: { nope: 1 } }), params)).status, 400);
    const done = signTicket({ uid: u.id, sid: SID, r: "r", p: manor.phases.length, f: [] });
    assert.equal((await guidePOST(post(u.cookie, done, { context: ctx }), params)).status, 400);
    handler = () => new Response("{}", { status: 500 });
    const prev = console.error;
    console.error = () => {};
    try {
      const bad = await guidePOST(post(u.cookie, ticket, { context: ctx }), params);
      assert.equal(bad.status, 502);
    } finally { console.error = prev; }
    assert.equal(guideQuota(u.id).freeLeftToday, 1);
    void freshTicket;
  });

  it("/api/me carries the guide quota", async () => {
    const u = await newUser();
    const me = await (await meGET(new Request("http://localhost:3000/api/me", { headers: { cookie: u.cookie } }))).json();
    assert.equal(me.guide.freeLeftToday, 1);
    assert.equal(me.guide.credits, 0);
    const guest = await (await meGET(new Request("http://localhost:3000/api/me"))).json();
    assert.equal(guest.guide, null);
  });

  it("a save file with a malformed guide is rejected", () => {
    assert.ok(saveFileOk(G));
    assert.ok(!saveFileOk({ diagnosis: 5, steps: "x" }));
  });
});
