import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dataDir = mkdtempSync(join(tmpdir(), "drama-routes-"));
process.env.DATA_DIR = dataDir;
process.env.OPEN_STORIES = "*"; // the route tests play the sample story, which is closed by default
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.DEEPSEEK_API_KEY = "sk-test-not-real";
process.env.ADMIN_EMAILS = "boss@example.com";

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { SESSION_COOKIE, requestCode, verifyCode } from "../lib/auth";
import { db } from "../lib/db";
import { getStory, saveStory, toPublicStory } from "../lib/stories";
import { freshTicket, signTicket } from "../lib/ticket";
import { StorySchema } from "../lib/schema";
import { POST as chatPOST } from "../app/api/stories/[id]/chat/[charId]/route";
import { POST as groupPOST } from "../app/api/stories/[id]/group-chat/route";
import { POST as generatePOST } from "../app/api/stories/generate/route";
import { GET as storyGET } from "../app/api/stories/[id]/route";
import { POST as resetPOST } from "../app/api/stories/[id]/reset/route";
import { GET as storiesGET } from "../app/api/stories/route";
import { GET as meGET } from "../app/api/me/route";
import { POST as requestCodePOST } from "../app/api/auth/request-code/route";
import { POST as verifyPOST } from "../app/api/auth/verify/route";
import { POST as logoutPOST } from "../app/api/auth/logout/route";

const SID = "sample-midnight-manor";
const story = getStory(SID)!;
const laterChar = story.characters.find((c) => c.unlockPhase !== story.phases[0].id)!;
const firstChar = story.characters.find((c) => c.unlockPhase === story.phases[0].id)!;
const secondFirst = story.characters.filter((c) => c.unlockPhase === story.phases[0].id)[1];

const H = { origin: "http://localhost:3000", host: "localhost:3000" };
let userCookie = "";
let adminCookie = "";
let userId = 0;

async function signIn(email: string) {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try { await requestCode(email, "ip-" + email, Date.now()); } finally { console.log = orig; }
  const code = /: (\d{6})/.exec(lines.join(""))![1];
  const r = verifyCode(email, code, "UA");
  assert.ok(r.ok);
  if (!r.ok) throw new Error("no login");
  return { cookie: `${SESSION_COOKIE}=${r.token}`, id: r.user.id };
}

before(async () => {
  const u = await signIn("player@example.com");
  userCookie = u.cookie;
  userId = u.id;
  adminCookie = (await signIn("boss@example.com")).cookie;
});

const emptyContext = { recent: [], events: [], notes: "", groupMembers: {}, history: [], groupChats: [] };
const post = (url: string, body: unknown, headers: Record<string, string> = {}, raw?: string) =>
  new Request(`http://localhost:3000${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...H, ...headers },
    body: raw ?? JSON.stringify(body),
  });
const chatParams = (charId: string) => ({ params: Promise.resolve({ id: SID, charId }) });
const idParams = { params: Promise.resolve({ id: SID }) };
const code = async (r: Response) => (await r.json()).code;

describe("routes", () => {
  it("chat route: 401 without a session", async () => {
    const res = await chatPOST(post(`/api/stories/${SID}/chat/${firstChar.id}`, { message: "hi", context: emptyContext }), chatParams(firstChar.id));
    assert.equal(res.status, 401);
    assert.equal(await code(res), "unauthorized");
  });

  it("chat route: foreign Origin is 403 bad_origin", async () => {
    const res = await chatPOST(
      post(`/api/stories/${SID}/chat/${firstChar.id}`, { message: "hi", context: emptyContext }, { cookie: userCookie, origin: "https://evil.example" }),
      chatParams(firstChar.id)
    );
    assert.equal(res.status, 403);
    assert.equal(await code(res), "bad_origin");
  });

  it("chat route: 413 for a 300 KB body", async () => {
    const res = await chatPOST(
      post(`/api/stories/${SID}/chat/${firstChar.id}`, null, { cookie: userCookie }, JSON.stringify({ message: "x".repeat(300_000) })),
      chatParams(firstChar.id)
    );
    assert.equal(res.status, 413);
    assert.equal(await code(res), "too_large");
  });

  it("chat route: 400 for history of 21 messages", async () => {
    const history = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "m" }));
    const res = await chatPOST(
      post(`/api/stories/${SID}/chat/${firstChar.id}`, { message: "hi", context: { ...emptyContext, history } }, { cookie: userCookie, "x-save-ticket": freshTicket(userId, SID) }),
      chatParams(firstChar.id)
    );
    assert.equal(res.status, 400);
    assert.equal(await code(res), "bad_request");
  });

  it("chat route: 400 ticket_invalid for a missing, edited or foreign ticket", async () => {
    const t = freshTicket(userId, SID);
    const [p, m] = t.split(".");
    const obj = JSON.parse(Buffer.from(p, "base64url").toString());
    obj.p = 3;
    const edited = `${Buffer.from(JSON.stringify(obj)).toString("base64url")}.${m}`;
    for (const ticket of [undefined, edited, freshTicket(userId + 1, SID)]) {
      const res = await chatPOST(
        post(`/api/stories/${SID}/chat/${firstChar.id}`, { message: "hi", context: emptyContext }, { cookie: userCookie, ...(ticket ? { "x-save-ticket": ticket } : {}) }),
        chatParams(firstChar.id)
      );
      assert.equal(res.status, 400);
      assert.equal(await code(res), "ticket_invalid");
    }
  });

  it("chat route: 403 locked for a character that unlocks later, by the ticket", async () => {
    const res = await chatPOST(
      post(`/api/stories/${SID}/chat/${laterChar.id}`, { message: "hi", context: emptyContext }, { cookie: userCookie, "x-save-ticket": freshTicket(userId, SID) }),
      chatParams(laterChar.id)
    );
    assert.equal(res.status, 403);
    assert.equal(await code(res), "locked");
  });

  it("chat route: a later chapter ticket unlocks it (passes the gates, reaches the 503 no key check)", async () => {
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const t = signTicket({ uid: userId, sid: SID, r: "r", p: story.phases.length, f: [] });
      const res = await chatPOST(
        post(`/api/stories/${SID}/chat/${laterChar.id}`, { message: "hi", context: emptyContext }, { cookie: userCookie, "x-save-ticket": t }),
        chatParams(laterChar.id)
      );
      assert.equal(res.status, 503);
      assert.equal(await code(res), "no_api_key");
    } finally {
      process.env.DEEPSEEK_API_KEY = saved;
    }
  });

  it("group chat route: locked member is 403, one member is 400", async () => {
    const group = (memberIds: string[]) => ({ message: "hi", group: { id: 1, memberIds }, context: { ...emptyContext, history: [], privateChats: {} } });
    const h = { cookie: userCookie, "x-save-ticket": freshTicket(userId, SID) };
    const locked = await groupPOST(post(`/api/stories/${SID}/group-chat`, group([firstChar.id, laterChar.id]), h), idParams);
    assert.equal(locked.status, 403);
    assert.equal(await code(locked), "locked");
    const one = await groupPOST(post(`/api/stories/${SID}/group-chat`, group([firstChar.id]), h), idParams);
    assert.equal(one.status, 400);
    const dup = await groupPOST(post(`/api/stories/${SID}/group-chat`, group([firstChar.id, firstChar.id]), h), idParams);
    assert.equal(dup.status, 400);
    const unknown = await groupPOST(post(`/api/stories/${SID}/group-chat`, group([firstChar.id, "nobody"]), h), idParams);
    assert.equal(unknown.status, 404);
    assert.ok(secondFirst);
  });

  it("generate: 403 not_admin for a non-admin, 401 for a guest", async () => {
    const res = await generatePOST(post("/api/stories/generate", { premise: "x" }, { cookie: userCookie }));
    assert.equal(res.status, 403);
    assert.equal(await code(res), "not_admin");
    const guest = await generatePOST(post("/api/stories/generate", { premise: "x" }));
    assert.equal(guest.status, 401);
  });

  it("generate: with ADMIN_EMAILS unset nobody is admin", async () => {
    const saved = process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAILS;
    try {
      const res = await generatePOST(post("/api/stories/generate", {}, { cookie: adminCookie }));
      assert.equal(res.status, 403);
    } finally {
      process.env.ADMIN_EMAILS = saved;
    }
  });

  it("generated stories are saved under DATA_DIR/stories and listed", async () => {
    const id = saveStory({ ...story, id: "my-generated-story" });
    assert.equal(id, "my-generated-story");
    assert.ok(readdirSync(join(dataDir, "stories")).includes("my-generated-story.json"));
    const list = await (await storiesGET(new Request("http://localhost:3000/api/stories"))).json();
    assert.ok(list.stories.some((s: { id: string }) => s.id === "my-generated-story"));
    assert.ok(list.stories.some((s: { id: string }) => s.id === SID));
    // a clash with a bundled id gets a new id, and the bundled story still wins
    const again = saveStory({ ...story, id: SID });
    assert.equal(again, `${SID}-2`);
    assert.equal(getStory(SID)!.title, story.title);
    // no progress fields in the summary
    assert.deepEqual(Object.keys(list.stories[0]).sort(), ["characterCount", "id", "phaseCount", "synopsis", "title"]);
  });

  it("GET /api/stories/[id]: 401 for guests; a fresh ticket and phase 0 for a user; same ticket echoed", async () => {
    const guest = await storyGET(new Request(`http://localhost:3000/api/stories/${SID}`), idParams);
    assert.equal(guest.status, 401);
    const res = await storyGET(new Request(`http://localhost:3000/api/stories/${SID}`, { headers: { cookie: userCookie } }), idParams);
    assert.equal(res.status, 200);
    const d = await res.json();
    assert.equal(d.story.phaseIndex, 0);
    assert.equal(typeof d.ticket, "string");
    const again = await storyGET(new Request(`http://localhost:3000/api/stories/${SID}`, { headers: { cookie: userCookie, "x-save-ticket": d.ticket } }), idParams);
    assert.equal((await again.json()).ticket, d.ticket);
    // a later-chapter ticket changes the view
    const t2 = signTicket({ uid: userId, sid: SID, r: "r", p: 1, f: [] });
    const later = await (await storyGET(new Request(`http://localhost:3000/api/stories/${SID}`, { headers: { cookie: userCookie, "x-save-ticket": t2 } }), idParams)).json();
    assert.equal(later.story.phaseIndex, 1);
    // bad ticket
    const bad = await storyGET(new Request(`http://localhost:3000/api/stories/${SID}`, { headers: { cookie: userCookie, "x-save-ticket": "junk" } }), idParams);
    assert.equal(bad.status, 400);
    assert.equal(await code(bad), "ticket_invalid");
    // an unknown story
    const nf = await storyGET(new Request("http://localhost:3000/api/stories/nope", { headers: { cookie: userCookie } }), { params: Promise.resolve({ id: "nope" }) });
    assert.equal(nf.status, 404);
  });

  it("the public story view never carries secrets", () => {
    for (let p = 0; p <= story.phases.length; p++) {
      const json = JSON.stringify(toPublicStory(story, p));
      for (const ph of story.phases) assert.ok(!json.includes(ph.completionCriteria), "completionCriteria leaked");
      for (const c of story.characters) {
        for (const secret of c.secrets) assert.ok(!json.includes(secret), "secret leaked");
        assert.ok(!json.includes(c.speechStyle), "speechStyle leaked");
        for (const k of Object.values(c.knowledgeByPhase)) assert.ok(!json.includes(k), "knowledge leaked");
      }
    }
    // locked characters are masked
    const v = toPublicStory(story, 0);
    const locked = v.characters.find((c) => c.id === laterChar.id)!;
    assert.equal(locked.name, "???");
    assert.equal(locked.unlocked, false);
  });

  it("reset: 401 for guests, a fresh run for users", async () => {
    const guest = await resetPOST(post(`/api/stories/${SID}/reset`, {}), idParams);
    assert.equal(guest.status, 401);
    const a = await (await resetPOST(post(`/api/stories/${SID}/reset`, {}, { cookie: userCookie }), idParams)).json();
    const b = await (await resetPOST(post(`/api/stories/${SID}/reset`, {}, { cookie: userCookie }), idParams)).json();
    assert.notEqual(a.ticket, b.ticket);
    const foreign = await resetPOST(post(`/api/stories/${SID}/reset`, {}, { cookie: userCookie, origin: "https://evil.example" }), idParams);
    assert.equal(foreign.status, 403);
  });

  it("/api/me: guests get 200 with user null; users get their profile", async () => {
    const guest = await meGET(new Request("http://localhost:3000/api/me"));
    assert.equal(guest.status, 200);
    const g = await guest.json();
    assert.equal(g.user, null);
    assert.equal(g.isAdmin, false);
    assert.equal(g.messages, null);
    assert.equal(typeof g.hasApiKey, "boolean");
    const me = await (await meGET(new Request("http://localhost:3000/api/me", { headers: { cookie: userCookie } }))).json();
    assert.equal(me.user.email, "player@example.com");
    assert.equal(me.isAdmin, false);
    assert.equal(me.messages.usedToday, 0);
    assert.equal(me.messages.cap, 200);
    const admin = await (await meGET(new Request("http://localhost:3000/api/me", { headers: { cookie: adminCookie } }))).json();
    assert.equal(admin.isAdmin, true);
  });

  it("auth routes: request-code answers ok, then 429 within a minute; foreign origin is 403", async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    let first: Response, second: Response;
    try {
      first = await requestCodePOST(post("/api/auth/request-code", { email: "new@example.com" }, { "cf-connecting-ip": "9.9.9.9" }));
      second = await requestCodePOST(post("/api/auth/request-code", { email: "new@example.com" }, { "cf-connecting-ip": "9.9.9.9" }));
    } finally {
      console.log = orig;
    }
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { ok: true });
    assert.ok(lines.some((l) => /\[dev mail\] code for new@example.com: \d{6}/.test(l)));
    assert.equal(second.status, 429);
    const b = await second.json();
    assert.equal(b.code, "rate_limited");
    assert.ok(b.retryAfter > 0);
    const foreign = await requestCodePOST(post("/api/auth/request-code", { email: "x@example.com" }, { origin: "https://evil.example" }));
    assert.equal(foreign.status, 403);
    const bad = await requestCodePOST(post("/api/auth/request-code", { email: "not-an-email" }));
    assert.equal(bad.status, 400);
  });

  it("verify sets an HttpOnly cookie and wrong codes answer the same 400; logout clears it", async () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try { await requestCodePOST(post("/api/auth/request-code", { email: "v@example.com" }, { "cf-connecting-ip": "8.8.8.8" })); } finally { console.log = orig; }
    const codeStr = /: (\d{6})/.exec(lines.join(""))![1];
    const wrong = await verifyPOST(post("/api/auth/verify", { email: "v@example.com", code: codeStr === "000000" ? "111111" : "000000" }));
    assert.equal(wrong.status, 400);
    assert.equal(await code(wrong), "invalid_code");
    const ok = await verifyPOST(post("/api/auth/verify", { email: "v@example.com", code: codeStr }));
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get("set-cookie")!;
    assert.match(cookie, /^dc_session=.+; HttpOnly; SameSite=Lax; Path=\//);
    assert.doesNotMatch(cookie, /Secure/);
    assert.equal((await ok.json()).user.email, "v@example.com");
    const token = /dc_session=([^;]+)/.exec(cookie)![1];
    assert.equal((db().prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?").get(token) as { n: number }).n, 0);
    const out = await logoutPOST(post("/api/auth/logout", {}, { cookie: `dc_session=${token}` }));
    assert.equal(out.status, 200);
    assert.match(out.headers.get("set-cookie")!, /Max-Age=0/);
    const noSession = await logoutPOST(post("/api/auth/logout", {}));
    assert.equal(noSession.status, 200);
    assert.equal((await meGET(new Request("http://localhost:3000/api/me", { headers: { cookie: `dc_session=${token}` } })).then((r) => r.json())).user, null);
  });

  it("StorySchema accepts the generated copy", () => {
    assert.ok(StorySchema.safeParse(getStory("my-generated-story")).success);
  });
});
