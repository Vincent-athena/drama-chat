import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "drama-ads-"));
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
process.env.DAY_TZ = "Asia/Ho_Chi_Minh";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.DEEPSEEK_API_KEY = "sk-test-not-real";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { abandonAdSession, completeAdSession, completedAdsToday, guideCredits, startAdSession } from "../lib/ads";
import { SESSION_COOKIE, requestCode, verifyCode } from "../lib/auth";
import { db } from "../lib/db";
import { adItemIds, missingRequired, ownedItemIds } from "../lib/items";
import { StorySchema, type Story } from "../lib/schema";
import { freshTicket } from "../lib/ticket";
import { decodeTicketPayload, type TicketPayload } from "../lib/ticket-payload";
import { POST as startPOST } from "../app/api/ads/sessions/route";
import { POST as completePOST } from "../app/api/ads/sessions/[id]/complete/route";
import { POST as abandonPOST } from "../app/api/ads/sessions/[id]/abandon/route";

const manor: Story = StorySchema.parse(JSON.parse(readFileSync(join(__dirname, "..", "stories", "sample-midnight-manor.json"), "utf8")));
const SID = manor.id;
const AD_ITEM = "solicitors-carbon"; // available from p3 (index 2)
const T0 = Date.UTC(2026, 5, 10, 5, 0, 0); // 12:00 in Ho Chi Minh
const ticketAt = (uid: number, p: number): TicketPayload => ({ ...decodeTicketPayload(freshTicket(uid, SID))!, p });

let n = 0;
async function newUser(): Promise<{ id: number; cookie: string }> {
  const email = `ads${n++}@example.com`;
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try { await requestCode(email, "ip-" + email, Date.now()); } finally { console.log = orig; }
  const r = verifyCode(email, /: (\d{6})/.exec(lines.join(""))![1], "UA");
  if (!r.ok) throw new Error("no login");
  return { id: r.user.id, cookie: `${SESSION_COOKIE}=${r.token}` };
}
const startItem = (uid: number, now: number, p = 2) =>
  startAdSession(uid, { rewardType: "item", storyId: SID, itemId: AD_ITEM }, { story: manor, ticket: ticketAt(uid, p) }, now);
const startGuide = (uid: number, now: number) => startAdSession(uid, { rewardType: "guide", storyId: SID }, { story: manor, ticket: null }, now);
const sid = (r: ReturnType<typeof startItem>) => { assert.ok(r.ok); return r.session.id; };

describe("ad sessions", () => {
  before(() => { db(); });

  it("completing before AD_MIN_SECONDS is too_early and grants nothing; later it works", async () => {
    const u = await newUser();
    const id = sid(startItem(u.id, T0));
    const early = completeAdSession(u.id, id, T0 + 14_000);
    assert.deepEqual(early, { ok: false, error: "too_early", retryAfter: 1 });
    assert.equal(adItemIds(u.id, SID).size, 0);
    const ok = completeAdSession(u.id, id, T0 + 15_000);
    assert.deepEqual(ok, { ok: true, reward: { type: "item", storyId: SID, itemId: AD_ITEM } });
  });

  it("a session can be completed once; the second time is used", async () => {
    const u = await newUser();
    const id = sid(startItem(u.id, T0));
    assert.ok(completeAdSession(u.id, id, T0 + 20_000).ok);
    const again = completeAdSession(u.id, id, T0 + 21_000);
    assert.deepEqual(again, { ok: false, error: "used" });
    assert.equal(db().prepare("SELECT COUNT(*) AS c FROM user_items WHERE user_id = ?").get(u.id) && (db().prepare("SELECT COUNT(*) AS c FROM user_items WHERE user_id = ?").get(u.id) as { c: number }).c, 1);
  });

  it("another user's id and an unknown id are both not_found", async () => {
    const a = await newUser();
    const b = await newUser();
    const id = sid(startItem(a.id, T0));
    assert.deepEqual(completeAdSession(b.id, id, T0 + 30_000), { ok: false, error: "not_found" });
    assert.deepEqual(completeAdSession(a.id, "f".repeat(32), T0 + 30_000), { ok: false, error: "not_found" });
    abandonAdSession(b.id, id); // not b's: nothing changes
    assert.ok(completeAdSession(a.id, id, T0 + 30_000).ok);
  });

  it("abandon, then complete, is used (and abandon is idempotent)", async () => {
    const u = await newUser();
    const id = sid(startItem(u.id, T0));
    assert.equal(abandonAdSession(u.id, id), true);
    assert.equal(abandonAdSession(u.id, id), false);
    assert.deepEqual(completeAdSession(u.id, id, T0 + 60_000), { ok: false, error: "used" });
    assert.equal(adItemIds(u.id, SID).size, 0);
  });

  it("the daily cap is shared by item and guide ads: the 11th completion is ad_cap", async () => {
    const u = await newUser();
    for (let i = 0; i < 10; i++) {
      const r = i === 0 ? startItem(u.id, T0 + i) : startGuide(u.id, T0 + i);
      assert.ok(completeAdSession(u.id, sid(r), T0 + i + 15_000).ok, `ad ${i}`);
    }
    assert.equal(completedAdsToday(u.id, T0 + 100_000), 10);
    const eleven = startGuide(u.id, T0 + 100_000);
    assert.equal(eleven.ok, false);
    assert.equal(!eleven.ok && eleven.error, "ad_cap");
    assert.ok(!eleven.ok && eleven.resetsAt && eleven.resetsAt > T0);
    // A session started before the cap was reached cannot complete past it either.
    const u2 = await newUser();
    const ids = Array.from({ length: 11 }, (_, i) => sid(startGuide(u2.id, T0 + i)));
    for (let i = 0; i < 10; i++) assert.ok(completeAdSession(u2.id, ids[i], T0 + 20_000).ok);
    assert.equal((completeAdSession(u2.id, ids[10], T0 + 20_000) as { error: string }).error, "ad_cap");
    // Next local day the cap is fresh.
    assert.ok(startGuide(u2.id, T0 + 24 * 3_600_000).ok);
  });

  it("an item ad inserts user_items with the ad session id, and the chapter gate opens", async () => {
    const u = await newUser();
    const id = sid(startItem(u.id, T0));
    const t = ticketAt(u.id, 2);
    assert.deepEqual(missingRequired(manor, 2, ownedItemIds(u.id, manor, t)), [AD_ITEM]);
    assert.ok(completeAdSession(u.id, id, T0 + 15_000).ok);
    const row = db().prepare("SELECT ad_session_id FROM user_items WHERE user_id = ? AND item_id = ?").get(u.id, AD_ITEM) as { ad_session_id: string };
    assert.equal(row.ad_session_id, id);
    assert.deepEqual(missingRequired(manor, 2, ownedItemIds(u.id, manor, t)), []);
    const s = db().prepare("SELECT status, redeemed_at, completed_at FROM ad_sessions WHERE id = ?").get(id) as { status: string; redeemed_at: number; completed_at: number };
    assert.deepEqual(s, { status: "completed", redeemed_at: T0 + 15_000, completed_at: T0 + 15_000 });
  });

  it("a guide ad leaves one unredeemed credit", async () => {
    const u = await newUser();
    assert.ok(completeAdSession(u.id, sid(startGuide(u.id, T0)), T0 + 15_000).ok);
    assert.equal(guideCredits(u.id), 1);
  });

  it("start refuses an owned item, a not-yet-available item, a non-ad item and a missing ticket", async () => {
    const u = await newUser();
    const early = startItem(u.id, T0, 0);
    assert.deepEqual(early, { ok: false, error: "bad_request" });
    for (const itemId of ["gala-invitation", "glass-shard", "nope"]) {
      const r = startAdSession(u.id, { rewardType: "item", storyId: SID, itemId }, { story: manor, ticket: ticketAt(u.id, 2) }, T0);
      assert.deepEqual(r, { ok: false, error: "bad_request" }, itemId);
    }
    assert.deepEqual(startAdSession(u.id, { rewardType: "item", storyId: SID, itemId: AD_ITEM }, { story: manor, ticket: null }, T0), { ok: false, error: "bad_request" });
    assert.ok(completeAdSession(u.id, sid(startItem(u.id, T0)), T0 + 15_000).ok);
    assert.deepEqual(startItem(u.id, T0 + 20_000), { ok: false, error: "already_owned" });
  });

  it("an ad-unlocked item survives a story restart (fresh ticket, same user_items)", async () => {
    const u = await newUser();
    assert.ok(completeAdSession(u.id, sid(startItem(u.id, T0)), T0 + 15_000).ok);
    const fresh = decodeTicketPayload(freshTicket(u.id, SID))!;
    assert.ok(ownedItemIds(u.id, manor, fresh).has(AD_ITEM));
  });

  it("starts are rate limited to 30 per hour", async () => {
    const u = await newUser();
    for (let i = 0; i < 30; i++) assert.ok(startGuide(u.id, T0 + i).ok);
    const r = startGuide(u.id, T0 + 40);
    assert.equal(!r.ok && r.error, "rate_limited");
  });
});

describe("ad routes", () => {
  const H = { origin: "http://localhost:3000", host: "localhost:3000" };
  const req = (url: string, cookie: string, body?: unknown, extra: Record<string, string> = {}) =>
    new Request(`http://localhost:3000${url}`, { method: "POST", headers: { "content-type": "application/json", cookie, ...H, ...extra }, body: JSON.stringify(body ?? {}) });
  const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

  it("start needs sign-in and, for items, a verifiable ticket; complete too early is 409 too_early", async () => {
    const u = await newUser();
    const anon = await startPOST(req("/api/ads/sessions", "", { rewardType: "guide", storyId: SID }));
    assert.equal(anon.status, 401);
    const noTicket = await startPOST(req("/api/ads/sessions", u.cookie, { rewardType: "item", storyId: SID, itemId: AD_ITEM }));
    assert.equal(noTicket.status, 400);
    const ticket = (await import("../lib/ticket")).signTicket({ uid: u.id, sid: SID, r: "r", p: 2, f: [] });
    const res = await startPOST(req("/api/ads/sessions", u.cookie, { rewardType: "item", storyId: SID, itemId: AD_ITEM }, { "x-save-ticket": ticket }));
    assert.equal(res.status, 200);
    const { session } = await res.json();
    assert.equal(session.provider, "standin");
    assert.equal(session.minSeconds, 15);
    const early = await completePOST(req(`/api/ads/sessions/${session.id}/complete`, u.cookie), idParams(session.id));
    assert.equal(early.status, 409);
    const eb = await early.json();
    assert.equal(eb.code, "too_early");
    assert.ok(eb.retryAfter >= 1);
    const other = await newUser();
    const wrong = await completePOST(req(`/api/ads/sessions/${session.id}/complete`, other.cookie), idParams(session.id));
    assert.equal(wrong.status, 404);
    const ab = await abandonPOST(req(`/api/ads/sessions/${session.id}/abandon`, u.cookie), idParams(session.id));
    assert.deepEqual(await ab.json(), { ok: true });
    const used = await completePOST(req(`/api/ads/sessions/${session.id}/complete`, u.cookie), idParams(session.id));
    assert.equal(used.status, 409);
    assert.equal((await used.json()).code, "used");
  });

  it("complete (backdated session) returns the public item without criteria", async () => {
    const u = await newUser();
    const id = sid(startItem(u.id, Date.now() - 60_000));
    const res = await completePOST(req(`/api/ads/sessions/${id}/complete`, u.cookie), idParams(id));
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.equal(body.reward.type, "item");
    assert.equal(body.reward.item.owned, true);
    assert.ok(!text.includes("obtainCriteria"));
  });

  it("no route grants without a started session: the schema rejects reward fields in a start body", async () => {
    const u = await newUser();
    const res = await startPOST(req("/api/ads/sessions", u.cookie, { rewardType: "grant", storyId: SID }));
    assert.equal(res.status, 400);
    assert.equal(db().prepare("SELECT COUNT(*) AS c FROM user_items WHERE user_id = ?").get(u.id) && (db().prepare("SELECT COUNT(*) AS c FROM user_items WHERE user_id = ?").get(u.id) as { c: number }).c, 0);
  });
});
