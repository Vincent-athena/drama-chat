import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "drama-ads-google-"));
process.env.OPEN_STORIES = "*"; // the route tests play the sample story, which is closed by default
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
process.env.DAY_TZ = "Asia/Ho_Chi_Minh";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.DEEPSEEK_API_KEY = "sk-test-not-real";

import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { afterEach, before, describe, it } from "node:test";
import { completeAdSession, startAdSession } from "../lib/ads";
import { SESSION_COOKIE, requestCode, verifyCode } from "../lib/auth";
import { db, MIGRATIONS } from "../lib/db";
import { adNoFill, adProvider, contactEmail, googleAdUnitPath, googlePublisherId } from "../lib/env";
import { StorySchema, type Story } from "../lib/schema";
import { GET as adsTxtGET } from "../app/ads.txt/route";
import { POST as startPOST } from "../app/api/ads/sessions/route";
import { POST as completePOST } from "../app/api/ads/sessions/[id]/complete/route";
import { GRANT_GRACE_MS, READY_TIMEOUT_MS, loadGpt, playRewarded, type Googletag, type RewardedOutcome } from "../lib/ad-providers/google-rewarded";

const manor: Story = StorySchema.parse(JSON.parse(readFileSync(join(__dirname, "..", "stories", "sample-midnight-manor.json"), "utf8")));
const SID = manor.id;
const T0 = Date.UTC(2026, 5, 10, 5, 0, 0);
const env = process.env as Record<string, string | undefined>;
const KEYS = ["AD_PROVIDER", "GOOGLE_AD_UNIT_PATH", "GOOGLE_PUBLISHER_ID", "AD_NO_FILL", "CONTACT_EMAIL"];
afterEach(() => { for (const k of KEYS) delete env[k]; });

let n = 0;
async function newUser(): Promise<{ id: number; cookie: string }> {
  const email = `adg${n++}@example.com`;
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try { await requestCode(email, "ip-" + email, Date.now()); } finally { console.log = orig; }
  const r = verifyCode(email, /: (\d{6})/.exec(lines.join(""))![1], "UA");
  if (!r.ok) throw new Error("no login");
  return { id: r.user.id, cookie: `${SESSION_COOKIE}=${r.token}` };
}
const startGuide = (uid: number, now: number) => startAdSession(uid, { rewardType: "guide", storyId: SID }, { story: manor, ticket: null }, now);
const shownOf = (id: string) => (db().prepare("SELECT shown, provider FROM ad_sessions WHERE id = ?").get(id) as { shown: string | null; provider: string });
const goGoogle = () => { env.AD_PROVIDER = "google"; env.GOOGLE_AD_UNIT_PATH = "/123/test_rewarded"; };

describe("env switches", () => {
  it("adProvider: unset, google without path, google with path, bad paths", () => {
    assert.equal(adProvider(), "standin");
    env.AD_PROVIDER = "google";
    const warn = console.warn; console.warn = () => {};
    try {
      assert.equal(adProvider(), "standin");
      for (const bad of ["no-slash", "/has space", "/" + "x".repeat(200)]) {
        env.GOOGLE_AD_UNIT_PATH = bad;
        assert.equal(googleAdUnitPath(), "");
        assert.equal(adProvider(), "standin");
      }
    } finally { console.warn = warn; }
    env.GOOGLE_AD_UNIT_PATH = "/123/test_rewarded";
    assert.equal(adProvider(), "google");
    env.AD_PROVIDER = "standin";
    assert.equal(adProvider(), "standin");
    delete env.AD_PROVIDER; // a path alone does not switch
    assert.equal(adProvider(), "standin");
  });

  it("googlePublisherId, adNoFill, contactEmail", () => {
    assert.equal(googlePublisherId(), "");
    for (const bad of ["pub-123", "ca-pub-1234567890", "pub-12345678901234567890123", "pub-abc4567890"]) {
      env.GOOGLE_PUBLISHER_ID = bad;
      assert.equal(googlePublisherId(), "");
    }
    env.GOOGLE_PUBLISHER_ID = "pub-1234567890123456";
    assert.equal(googlePublisherId(), "pub-1234567890123456");
    assert.equal(adNoFill(), "house");
    env.AD_NO_FILL = "deny";
    assert.equal(adNoFill(), "deny");
    assert.equal(contactEmail(), "");
  });
});

describe("google sessions", () => {
  before(() => { db(); });

  it("standin by default; google block and stored provider when configured", async () => {
    const u = await newUser();
    const a = startGuide(u.id, T0);
    assert.ok(a.ok);
    if (!a.ok) return;
    assert.equal(a.session.provider, "standin");
    assert.equal(a.session.google, undefined);
    assert.equal(shownOf(a.session.id).provider, "standin");
    goGoogle();
    env.AD_NO_FILL = "deny";
    const b = startGuide(u.id, T0 + 1000);
    assert.ok(b.ok);
    if (!b.ok) return;
    assert.equal(b.session.provider, "google");
    assert.deepEqual(b.session.google, { adUnitPath: "/123/test_rewarded", noFill: "deny" });
    assert.equal(shownOf(b.session.id).provider, "google");
  });

  it("completion records shown: network, null when absent, house forced for standin; time floor still applies", async () => {
    const u = await newUser();
    goGoogle();
    const g1 = startGuide(u.id, T0); assert.ok(g1.ok); if (!g1.ok) return;
    assert.deepEqual(completeAdSession(u.id, g1.session.id, T0 + 1000, "network"), { ok: false, error: "too_early", retryAfter: 14 });
    assert.equal(shownOf(g1.session.id).shown, null);
    assert.ok(completeAdSession(u.id, g1.session.id, T0 + 20_000, "network").ok);
    assert.equal(shownOf(g1.session.id).shown, "network");
    const g2 = startGuide(u.id, T0 + 30_000); assert.ok(g2.ok); if (!g2.ok) return;
    assert.ok(completeAdSession(u.id, g2.session.id, T0 + 60_000).ok);
    assert.equal(shownOf(g2.session.id).shown, null);
    delete env.AD_PROVIDER;
    const s = startGuide(u.id, T0 + 70_000); assert.ok(s.ok); if (!s.ok) return;
    assert.ok(completeAdSession(u.id, s.session.id, T0 + 100_000, "network").ok);
    assert.equal(shownOf(s.session.id).shown, "house");
  });

  it("migration v4 adds shown to a v3 database and keeps rows", () => {
    const d = new Database(":memory:");
    d.pragma("foreign_keys = ON");
    for (let i = 0; i < 3; i++) MIGRATIONS[i](d);
    d.pragma("user_version = 3");
    d.prepare("INSERT INTO users (email, display_name, created_at, last_login_at) VALUES ('a@example.com','A',1,1)").run();
    d.prepare("INSERT INTO ad_sessions (id,user_id,reward_type,story_id,provider,started_at,status) VALUES ('s1',1,'guide','x','standin',5,'started')").run();
    MIGRATIONS[3](d);
    const row = d.prepare("SELECT id, provider, shown FROM ad_sessions").get();
    assert.deepEqual(row, { id: "s1", provider: "standin", shown: null });
    d.close();
  });
});

describe("routes", () => {
  const H = { origin: "http://localhost:3000", host: "localhost:3000" };
  const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (url: string, cookie: string, body: string | undefined) =>
    new Request(`http://localhost:3000${url}`, { method: "POST", headers: { "content-type": "application/json", cookie, ...H }, body });

  async function completeWith(body: string | undefined) {
    goGoogle();
    const u = await newUser();
    const s = startGuide(u.id, Date.now() - 60_000); assert.ok(s.ok); if (!s.ok) return null;
    const res = await completePOST(post(`/api/ads/sessions/${s.session.id}/complete`, u.cookie, body), idParams(s.session.id));
    return { res, shown: shownOf(s.session.id).shown };
  }

  it("complete accepts no body, a valid body, and ignores invalid bodies", async () => {
    const none = await completeWith(undefined);
    assert.equal(none?.res.status, 200); assert.equal(none?.shown, null);
    const ok = await completeWith(JSON.stringify({ shown: "network" }));
    assert.equal(ok?.res.status, 200); assert.equal(ok?.shown, "network");
    for (const bad of ["{not json", JSON.stringify({ shown: "gold" }), JSON.stringify({ shown: "x".repeat(5000) })]) {
      const r = await completeWith(bad);
      assert.equal(r?.res.status, 200); assert.equal(r?.shown, null);
    }
  });

  it("start route returns the google block", async () => {
    goGoogle();
    const u = await newUser();
    const res = await startPOST(post("/api/ads/sessions", u.cookie, JSON.stringify({ rewardType: "guide", storyId: SID })));
    const body = await res.json();
    assert.equal(body.session.provider, "google");
    assert.equal(body.session.google.adUnitPath, "/123/test_rewarded");
  });

  it("/ads.txt: 404 unset or invalid, the line when set", async () => {
    assert.equal((await adsTxtGET()).status, 404);
    env.GOOGLE_PUBLISHER_ID = "pub-12";
    assert.equal((await adsTxtGET()).status, 404);
    env.GOOGLE_PUBLISHER_ID = "pub-1234567890123456";
    const res = await adsTxtGET();
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/plain/);
    assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
    assert.equal((await res.text()).trim(), "google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0");
  });
});

describe("google rewarded state machine (fake googletag)", () => {
  type L = (e: Record<string, unknown>) => void;
  function fake(opts: { nullSlot?: boolean } = {}) {
    const listeners = new Map<string, Set<L>>();
    const slot = { addService: () => slot };
    const calls = { defined: 0, destroyed: 0, displayed: 0, visible: 0 };
    const gt = {
      cmd: { push: (fn: () => void) => fn() },
      enums: { OutOfPageFormat: { REWARDED: "REWARDED" } },
      defineOutOfPageSlot: () => { calls.defined++; return opts.nullSlot ? null : slot; },
      pubads: () => ({
        addEventListener: (t: string, l: L) => { (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(l); },
        removeEventListener: (t: string, l: L) => { listeners.get(t)?.delete(l); },
      }),
      enableServices: () => {},
      display: () => { calls.displayed++; },
      destroySlots: () => { calls.destroyed++; return true; },
    } as unknown as Googletag;
    const emit = (t: string, e: Record<string, unknown> = {}) => [...(listeners.get(t) ?? [])].forEach((l) => l({ slot, ...e }));
    const count = () => [...listeners.values()].reduce((a, s) => a + s.size, 0);
    return { gt, slot, calls, emit, count };
  }
  function clock() {
    let id = 0; const q = new Map<number, { at: number; fn: () => void }>(); let now = 0;
    return {
      set: ((fn: () => void, ms: number) => { q.set(++id, { at: now + ms, fn }); return id; }) as unknown as typeof setTimeout,
      clear: ((h: number) => { q.delete(h); }) as unknown as typeof clearTimeout,
      advance(ms: number) { now += ms; for (const [k, t] of [...q]) if (t.at <= now) { q.delete(k); t.fn(); } },
    };
  }
  const run = (f: ReturnType<typeof fake>, c = clock()) => {
    const out: RewardedOutcome[] = [];
    const p = playRewarded(f.gt, "/1/x", (o) => out.push(o), c);
    return { out, p, c };
  };

  it("the default timers call setTimeout and clearTimeout unbound (a browser throws Illegal invocation otherwise)", () => {
    // Found in the browser: passing the bare functions as { set, clear } called them as methods and crashed the page.
    const real = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
    const strict = (fn: (...a: never[]) => unknown) =>
      function (this: unknown, ...a: never[]) {
        if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
        return fn(...a);
      };
    globalThis.setTimeout = strict(real.set as never) as never;
    globalThis.clearTimeout = strict(real.clear as never) as never;
    try {
      const f = fake();
      const p = playRewarded(f.gt, "/1/x", () => {});
      p.dispose();
      assert.equal(f.calls.destroyed, 1);
    } finally {
      globalThis.setTimeout = real.set;
      globalThis.clearTimeout = real.clear;
    }
  });

  it("a ready ad that cannot be displayed (makeRewardedVisible returns false) is no fill, not an endless wait", () => {
    const f = fake(); const r = run(f);
    f.emit("rewardedSlotReady", { makeRewardedVisible: () => false });
    assert.deepEqual(r.out, ["nofill"]);
    assert.equal(f.calls.destroyed, 1); assert.equal(f.count(), 0);
    r.c.advance(READY_TIMEOUT_MS);
    assert.deepEqual(r.out, ["nofill"]);
  });

  it("ready shows the ad; granted then closed is network; slot destroyed and listeners removed", () => {
    const f = fake(); const { out } = run(f);
    assert.equal(f.calls.defined, 1); assert.equal(f.calls.displayed, 1);
    let visible = 0;
    f.emit("rewardedSlotReady", { makeRewardedVisible: () => { visible++; return true; } });
    assert.equal(visible, 1);
    f.emit("slotRenderEnded", { isEmpty: false });
    f.emit("rewardedSlotGranted");
    f.emit("rewardedSlotClosed");
    f.emit("rewardedSlotClosed");
    assert.deepEqual(out, ["network"]);
    assert.equal(f.calls.destroyed, 1); assert.equal(f.count(), 0);
  });

  it("closed without grant is cancel (after a short grace); closed before granted still counts", () => {
    const f = fake(); const r = run(f);
    f.emit("rewardedSlotReady", { makeRewardedVisible: () => true });
    f.emit("rewardedSlotClosed");
    r.c.advance(GRANT_GRACE_MS);
    assert.deepEqual(r.out, ["cancel"]);
    const g = fake(); const r2 = run(g);
    g.emit("rewardedSlotClosed"); g.emit("rewardedSlotGranted");
    assert.deepEqual(r2.out, ["network"]);
  });

  it("no fill, ineligible page, script failure and the 10 s timeout are all nofill", () => {
    const a = fake(); const ra = run(a);
    a.emit("slotRenderEnded", { isEmpty: true });
    assert.deepEqual(ra.out, ["nofill"]); assert.equal(a.calls.destroyed, 1);
    const b = fake({ nullSlot: true }); assert.deepEqual(run(b).out, ["nofill"]);
    const c = fake(); const rc = run(c); rc.p.fail(); assert.deepEqual(rc.out, ["nofill"]);
    const d = fake(); const rd = run(d);
    rd.c.advance(READY_TIMEOUT_MS - 1); assert.deepEqual(rd.out, []);
    rd.c.advance(1); assert.deepEqual(rd.out, ["nofill"]);
    const e = fake(); const re = run(e);
    e.emit("rewardedSlotReady", { makeRewardedVisible: () => true });
    re.c.advance(READY_TIMEOUT_MS * 2); assert.deepEqual(re.out, []); // ready cancels the timeout
  });

  it("dispose (unmount) destroys the slot, removes listeners and silences callbacks; events for other slots are ignored", () => {
    const f = fake(); const r = run(f);
    f.emit("rewardedSlotGranted", { slot: {} }); f.emit("rewardedSlotClosed", { slot: {} });
    assert.deepEqual(r.out, []);
    r.p.dispose(); r.p.dispose();
    f.emit("rewardedSlotGranted"); f.emit("rewardedSlotClosed");
    assert.deepEqual(r.out, []);
    assert.equal(f.calls.destroyed, 1); assert.equal(f.count(), 0);
  });

  it("disposing before gpt runs the queued command defines no slot (strict-mode double mount)", () => {
    const queue: (() => void)[] = [];
    const f = fake(); (f.gt as unknown as { cmd: unknown }).cmd = { push: (fn: () => void) => queue.push(fn) };
    const out: RewardedOutcome[] = [];
    const first = playRewarded(f.gt, "/1/x", (o) => out.push(o), clock());
    first.dispose();
    playRewarded(f.gt, "/1/x", (o) => out.push(o), clock());
    queue.forEach((fn) => fn());
    assert.equal(f.calls.defined, 1);
  });
});

describe("loadGpt (fake window)", () => {
  function fakeWindow() {
    type El = { src: string; async: boolean; attrs: Map<string, string>; on: Map<string, (() => void)[]> } & Record<string, unknown>;
    const scripts: El[] = [];
    const timeouts: (() => void)[] = [];
    const make = (): El => {
      const el: El = { src: "", async: false, attrs: new Map(), on: new Map() } as El;
      el.addEventListener = (t: string, l: () => void) => { el.on.set(t, [...(el.on.get(t) ?? []), l]); };
      el.setAttribute = (k: string, v: string) => { el.attrs.set(k, v); };
      el.hasAttribute = (k: string) => el.attrs.has(k);
      return el;
    };
    const win = {
      googletag: undefined as unknown,
      setTimeout: (fn: () => void) => { timeouts.push(fn); return 0; },
      document: {
        querySelector: (sel: string) => scripts.find((x) => sel.includes(x.src)) ?? null,
        createElement: make,
        head: { appendChild: (el: El) => { scripts.push(el); } },
      },
    };
    const fire = (t: string) => scripts.forEach((x) => (x.on.get(t) ?? []).forEach((l) => l()));
    const flush = () => timeouts.splice(0).forEach((fn) => fn());
    return { win: win as never, scripts, fire, flush };
  }

  it("adds one script per page, reuses window.googletag and keeps its queue", () => {
    const w = fakeWindow();
    const a = loadGpt(w.win, () => {});
    const b = loadGpt(w.win, () => {});
    assert.equal(w.scripts.length, 1);
    assert.match(w.scripts[0].src, /^https:\/\/securepubads\.g\.doubleclick\.net\/tag\/js\/gpt\.js$/);
    assert.equal(a, b);
    assert.ok(Array.isArray(a.cmd));
  });

  it("a failed script tells every waiting caller, and a later caller at once", () => {
    const w = fakeWindow();
    let first = 0, second = 0, later = 0;
    loadGpt(w.win, () => first++);
    loadGpt(w.win, () => second++);
    w.fire("error");
    assert.deepEqual([first, second], [1, 1]);
    loadGpt(w.win, () => later++);
    assert.equal(later, 0); // asynchronous, so the caller has its player assigned before it hears
    w.flush();
    assert.equal(later, 1);
    assert.equal(w.scripts.length, 1);
  });
});
