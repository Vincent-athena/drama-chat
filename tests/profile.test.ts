import "fake-indexeddb/auto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "drama-profile-"));
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DELETE as meDELETE, GET as meGET, PATCH as mePATCH } from "../app/api/me/route";
import { DELETE as sessionsDELETE, GET as sessionsGET } from "../app/api/me/sessions/route";
import {
  deleteAccount, deleteAllSessions, listSessions, requestCode, SESSION_COOKIE, updateProfile, verifyCode,
} from "../lib/auth";
import { db } from "../lib/db";
import { ProfilePatchSchema } from "../lib/profile";
import { characterSystemPrompt } from "../lib/prompts";
import { getStory } from "../lib/stories";
import { parseSaveFile } from "../lib/save/file";
import { LocalSaveStore } from "../lib/save/local";
import { signTicket } from "../lib/ticket";

const T0 = Date.now();
let ipN = 0;
let clock = T0;

async function signIn(email: string, ua = "UA") {
  const now = (clock += 61_000); // the same email may ask for a code once a minute
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try { await requestCode(email, `ip-${++ipN}`, now); } finally { console.log = orig; }
  const code = /: (\d{6})/.exec(lines.join(""))![1];
  const r = verifyCode(email, code, ua, now);
  assert.ok(r.ok);
  if (!r.ok) throw new Error("no login");
  return { user: r.user, token: r.token, cookie: `${SESSION_COOKIE}=${r.token}` };
}
const call = (method: string, url: string, cookie: string, body?: unknown) =>
  new Request(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost:3000", host: "localhost:3000", cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("ProfilePatchSchema", () => {
  it("trims and collapses the name", () => {
    const r = ProfilePatchSchema.safeParse({ displayName: "  Ann   Lee " });
    assert.ok(r.success);
    assert.equal(r.data.displayName, "Ann Lee");
  });
  it("rejects 41 chars, empty, angle brackets, control chars, unknown emoji, empty patch", () => {
    assert.equal(ProfilePatchSchema.safeParse({ displayName: "a".repeat(40) }).success, true);
    assert.equal(ProfilePatchSchema.safeParse({ displayName: "a".repeat(41) }).success, false);
    assert.equal(ProfilePatchSchema.safeParse({ displayName: "   " }).success, false);
    assert.equal(ProfilePatchSchema.safeParse({ displayName: "<b>" }).success, false);
    assert.equal(ProfilePatchSchema.safeParse({ displayName: "a\u0007b" }).success, false);
    assert.equal(ProfilePatchSchema.safeParse({ avatarEmoji: "💩" }).success, false);
    assert.equal(ProfilePatchSchema.safeParse({ avatarEmoji: "🦊" }).success, true);
    assert.equal(ProfilePatchSchema.safeParse({}).success, false);
  });
});

describe("profile and sessions", () => {
  it("updateProfile persists", async () => {
    const { user } = await signIn("up@example.com");
    const u = updateProfile(user.id, { displayName: "Ann Lee", avatarEmoji: "🦊" });
    assert.equal(u.displayName, "Ann Lee");
    assert.equal(u.avatarEmoji, "🦊");
    const only = updateProfile(user.id, { displayName: "Ann" });
    assert.equal(only.avatarEmoji, "🦊");
  });

  it("PATCH /api/me validates and returns MeResponse", async () => {
    const { cookie } = await signIn("patch@example.com");
    const ok = await mePATCH(call("PATCH", "/api/me", cookie, { displayName: "  Ann   Lee " }));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).user.displayName, "Ann Lee");
    for (const bad of [{ displayName: "x".repeat(41) }, { displayName: "" }, { displayName: "<b>" }, { avatarEmoji: "💩" }, {}]) {
      assert.equal((await mePATCH(call("PATCH", "/api/me", cookie, bad))).status, 400, JSON.stringify(bad));
    }
    const noOrigin = new Request("http://localhost:3000/api/me", { method: "PATCH", headers: { cookie, host: "localhost:3000" }, body: "{}" });
    assert.equal((await mePATCH(noOrigin)).status, 403);
    assert.equal((await mePATCH(call("PATCH", "/api/me", "", { displayName: "x" }))).status, 401);
  });

  it("listSessions marks current, drops expired and other users, exposes no token", async () => {
    const a1 = await signIn("ls@example.com", "Agent A");
    const a2 = await signIn("ls@example.com", "Agent B");
    const other = await signIn("ls-other@example.com");
    const rows = db().prepare("SELECT id, token_hash FROM sessions WHERE user_id = ? ORDER BY id").all(a1.user.id) as { id: number; token_hash: string }[];
    assert.equal(rows.length, 2);
    // expire the first one
    db().prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(T0, rows[0].id);
    const list = listSessions(a1.user.id, rows[1].id, T0 + 10_000);
    assert.equal(list.length, 1);
    assert.equal(list[0].current, true);
    assert.equal(list[0].userAgent, "Agent B");
    assert.ok(!JSON.stringify(list).includes(a2.token) && !JSON.stringify(list).includes(rows[1].token_hash));
    void other;
  });

  it("GET /api/me/sessions: exactly one current, only this user's", async () => {
    const one = await signIn("g1@example.com", "One");
    await signIn("g1@example.com", "Two");
    await signIn("g2@example.com");
    const res = await sessionsGET(call("GET", "/api/me/sessions", one.cookie));
    const body = await res.json();
    assert.equal(body.sessions.length, 2);
    assert.equal(body.sessions.filter((s: { current: boolean }) => s.current).length, 1);
    assert.equal(body.sessions.find((s: { current: boolean }) => s.current).userAgent, "One");
    assert.ok(!/token|hash/i.test(JSON.stringify(body)));
  });

  it("deleteAllSessions empties only this user's; DELETE /api/me/sessions signs out everywhere", async () => {
    const a = await signIn("da@example.com");
    const a2 = await signIn("da@example.com");
    const b = await signIn("db@example.com");
    const res = await sessionsDELETE(call("DELETE", "/api/me/sessions", a.cookie));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await meGET(call("GET", "/api/me", a.cookie))).status, 200);
    assert.equal((await (await meGET(call("GET", "/api/me", a.cookie))).json()).user, null);
    assert.equal((await (await meGET(call("GET", "/api/me", a2.cookie))).json()).user, null);
    assert.ok((await (await meGET(call("GET", "/api/me", b.cookie))).json()).user);
    const c = await signIn("dc@example.com");
    deleteAllSessions(c.user.id);
    assert.equal((db().prepare("SELECT COUNT(*) n FROM sessions WHERE user_id = ?").get(c.user.id) as { n: number }).n, 0);
    assert.equal((db().prepare("SELECT COUNT(*) n FROM sessions WHERE user_id = ?").get(b.user.id) as { n: number }).n, 1);
  });
});

describe("deleteAccount", () => {
  it("removes user, sessions and login code; leaves others; a new sign-in gets a new id", async () => {
    const gone = await signIn("gone@example.com");
    await signIn("gone@example.com");
    const keep = await signIn("keep@example.com");
    // a live login code for the account's email
    const orig = console.log;
    console.log = () => undefined;
    try { await requestCode("gone@example.com", `ip-${++ipN}`, Date.now()); } finally { console.log = orig; }
    assert.equal((db().prepare("SELECT COUNT(*) n FROM login_codes WHERE email = 'gone@example.com'").get() as { n: number }).n, 1);

    // child table cascade: use user_items when it exists
    const hasItems = db().prepare("SELECT 1 FROM sqlite_master WHERE name = 'user_items'").get();
    if (hasItems) {
      db().prepare("INSERT INTO user_items (user_id, story_id, item_id, acquired_at) VALUES (?, 's', 'i', 1)").run(gone.user.id);
    }

    deleteAccount(gone.user.id);
    const n = (sql: string, ...a: unknown[]) => (db().prepare(sql).get(...a) as { n: number }).n;
    assert.equal(n("SELECT COUNT(*) n FROM users WHERE id = ?", gone.user.id), 0);
    assert.equal(n("SELECT COUNT(*) n FROM sessions WHERE user_id = ?", gone.user.id), 0);
    assert.equal(n("SELECT COUNT(*) n FROM login_codes WHERE email = 'gone@example.com'"), 0);
    if (hasItems) assert.equal(n("SELECT COUNT(*) n FROM user_items WHERE user_id = ?", gone.user.id), 0);
    assert.equal(n("SELECT COUNT(*) n FROM users WHERE id = ?", keep.user.id), 1);
    assert.equal(n("SELECT COUNT(*) n FROM sessions WHERE user_id = ?", keep.user.id), 1);

    const again = await signIn("gone@example.com");
    assert.notEqual(again.user.id, gone.user.id);
  });

  it("DELETE /api/me needs the email typed (case-insensitive)", async () => {
    const u = await signIn("Del.Me@example.com");
    const bad = await meDELETE(call("DELETE", "/api/me", u.cookie, { confirmEmail: "nope@example.com" }));
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "Type your email exactly to confirm.");
    assert.equal((await meDELETE(call("DELETE", "/api/me", u.cookie, {}))).status, 400);
    const ok = await meDELETE(call("DELETE", "/api/me", u.cookie, { confirmEmail: " DEL.ME@example.com " }));
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((db().prepare("SELECT COUNT(*) n FROM users WHERE id = ?").get(u.user.id) as { n: number }).n, 0);
  });
});

describe("parseSaveFile and the save store", () => {
  const good = (userId: number) => ({
    format: "drama-chat-save", version: 1, exportedAt: 1, userId,
    stores: { progress: [], messages: [], groups: [], events: [], notes: [], guides: [] },
  });
  it("accepts a good file and refuses the rest", () => {
    assert.equal(parseSaveFile(good(7), 7).ok, true);
    assert.deepEqual(parseSaveFile({ ...good(7), format: "x" }, 7), { ok: false, error: "Not a Drama Chat save file." });
    assert.deepEqual(parseSaveFile({ ...good(7), version: 2 }, 7), { ok: false, error: "Not a Drama Chat save file." });
    assert.deepEqual(parseSaveFile("hello", 7), { ok: false, error: "Not a Drama Chat save file." });
    assert.deepEqual(parseSaveFile(good(8), 7), { ok: false, error: "This save belongs to another account." });
  });

  it("export then import restores chats and progress; destroy wipes", async () => {
    const S = "story-a";
    const s = new LocalSaveStore(4242);
    await s.setTicket(S, signTicket({ uid: 4242, sid: S, r: "run1", p: 2, f: [] }));
    await s.addMessage(S, "x", { role: "user", content: "hi" });
    await s.addMessage(S, "x", { role: "assistant", content: "hello" });
    const g = await s.createGroup(S, ["a", "b"]);
    await s.addGroupMessage(S, g.id, "", { role: "user", content: "group hi" });
    await s.addEvent(S, 0, "something happened");
    await s.setChapterNotes(S, 1, "notes");
    assert.equal(await s.countUserMessages(), 2);

    const file = await s.exportAll();
    const reparsed = parseSaveFile(JSON.parse(JSON.stringify(file)), 4242);
    assert.ok(reparsed.ok);
    if (!reparsed.ok) return;

    await s.resetStory(S);
    await s.addMessage("other", "z", { role: "user", content: "will be replaced" });
    assert.equal(await s.getPhaseIndex(S), 0);

    await s.importAll(reparsed.file);
    assert.equal(await s.getPhaseIndex(S), 2);
    assert.deepEqual((await s.getHistory(S, "x")).map((m) => m.content), ["hi", "hello"]);
    assert.deepEqual((await s.getHistory("other", "z")), []);
    assert.deepEqual((await s.listGroups(S)).map((x) => x.memberIds), [["a", "b"]]);
    assert.deepEqual((await s.getGroupHistory(S, g.id)).map((m) => m.content), ["group hi"]);
    assert.deepEqual(await s.getEvents(S), ["something happened"]);
    assert.equal(await s.getChapterNotes(S, 1), "notes");
    // ids keep counting after the imported ones
    await s.addMessage(S, "x", { role: "user", content: "after import" });
    assert.equal((await s.getHistory(S, "x")).length, 3);

    await s.destroy();
    const fresh = new LocalSaveStore(4242);
    assert.deepEqual(await fresh.listProgress(), []);
    assert.equal(await fresh.countUserMessages(), 0);
  });
});

describe("characterSystemPrompt playerName", () => {
  const story = getStory("sample-midnight-manor")!;
  const c = story.characters[0];
  it("adds the called line only when a name is set", () => {
    const withName = characterSystemPrompt(story, c, 0, [], { playerName: "Ann Lee" });
    assert.ok(withName.includes('called "Ann Lee"'));
    assert.ok(withName.indexOf('called "Ann Lee"') > withName.indexOf("## Rules"));
    assert.ok(!characterSystemPrompt(story, c, 0, [], {}).includes("is called"));
  });
});
