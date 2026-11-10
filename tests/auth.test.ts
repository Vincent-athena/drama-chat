import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "drama-auth-"));
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  isAdminEmail, normalizeEmail, requestCode, requireUser, sessionCookie, SESSION_COOKIE, signOut, verifyCode, getSessionUser,
} from "../lib/auth";
import { db, MIGRATIONS } from "../lib/db";

const T0 = 1_800_000_000_000;
let ipN = 0;
const freshIp = () => `ip-${++ipN}`;

/** Requests a code and returns the plaintext, which the dev mailer prints. */
async function codeFor(email: string, now = T0, ip = freshIp()): Promise<string> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try {
    const r = await requestCode(email, ip, now);
    assert.equal(r.ok, true);
  } finally {
    console.log = orig;
  }
  const m = /code for \S+: (\d{6})/.exec(lines.join("\n"));
  assert.ok(m, "dev mail line missing");
  return m[1];
}

const reqWithToken = (token?: string) =>
  new Request("http://localhost:3000/api/me", { headers: token ? { cookie: `${SESSION_COOKIE}=${token}` } : {} });

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("auth", () => {
  it("migrates a fresh DB to the latest version with the account and item tables only", () => {
    assert.equal(db().pragma("user_version", { simple: true }), MIGRATIONS.length);
    assert.equal(MIGRATIONS.length, 2);
    const tables = (db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
      .map((t) => t.name).sort();
    assert.deepEqual(tables, ["counters", "login_codes", "sessions", "user_items", "users"]);
  });

  it("normalises emails", () => {
    assert.equal(normalizeEmail(" A@B.co "), "a@b.co");
    assert.equal(normalizeEmail("nope"), null);
    assert.equal(normalizeEmail("a@b"), null);
  });

  it("stores the code hashed and signs in with the right one, creating the user", async () => {
    const code = await codeFor("a@b.co");
    const row = db().prepare("SELECT * FROM login_codes WHERE email = ?").get("a@b.co") as Record<string, unknown>;
    assert.ok(!JSON.stringify(row).includes(code));
    assert.match(String(row.code_hash), /^[0-9a-f]{64}$/);
    const res = verifyCode("A@B.co", code, "UA/1", T0 + 1000);
    assert.ok(res.ok);
    if (!res.ok) return;
    assert.equal(res.user.email, "a@b.co");
    assert.equal(res.user.displayName, "a");
    assert.equal(res.user.avatarEmoji, "🎭");
    assert.equal((db().prepare("SELECT COUNT(*) AS n FROM login_codes WHERE email = ?").get("a@b.co") as { n: number }).n, 0);
    // a code works once
    assert.equal(verifyCode("a@b.co", code, "UA", T0 + 2000).ok, false);
    // the DB keeps only the sha256 of the token
    const sess = db().prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[];
    assert.ok(sess.every((s) => s.token_hash !== res.token && /^[0-9a-f]{64}$/.test(s.token_hash)));
  });

  it("fails after five wrong codes even with the right one", async () => {
    const code = await codeFor("five@b.co");
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) assert.equal(verifyCode("five@b.co", wrong, "UA", T0 + i).ok, false);
    assert.equal(verifyCode("five@b.co", code, "UA", T0 + 10).ok, false);
  });

  it("rejects an expired code", async () => {
    const code = await codeFor("late@b.co");
    assert.equal(verifyCode("late@b.co", code, "UA", T0 + 11 * 60_000).ok, false);
  });

  it("a new request replaces the old code", async () => {
    const first = await codeFor("two@b.co", T0);
    const second = await codeFor("two@b.co", T0 + 2 * 60_000);
    if (first !== second) assert.equal(verifyCode("two@b.co", first, "UA", T0 + 3 * 60_000).ok, false);
    assert.ok(verifyCode("two@b.co", second, "UA", T0 + 3 * 60_000).ok);
  });

  it("looks up sessions, expires them and signs out", async () => {
    const res = verifyCode("s@b.co", await codeFor("s@b.co"), "UA", T0);
    assert.ok(res.ok);
    if (!res.ok) return;
    assert.equal(getSessionUser(reqWithToken(res.token), T0 + 1000)?.user.email, "s@b.co");
    assert.equal(getSessionUser(reqWithToken("bogus"), T0), null);
    // expired: ignored and deleted
    assert.equal(getSessionUser(reqWithToken(res.token), T0 + 31 * 24 * 3600_000), null);
    assert.equal((db().prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(res.user.id) as { n: number }).n, 0);

    const again = verifyCode("s@b.co", await codeFor("s@b.co", T0 + 120_000), "UA", T0 + 121_000);
    assert.ok(again.ok);
    if (!again.ok) return;
    assert.ok(getSessionUser(reqWithToken(again.token), T0 + 122_000));
    signOut(again.token);
    assert.equal(getSessionUser(reqWithToken(again.token), T0 + 123_000), null);
  });

  it("requireUser answers 401 unauthorized without a cookie", async () => {
    const r = requireUser(reqWithToken());
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.response.status, 401);
    assert.equal((await r.response.json()).code, "unauthorized");
  });

  it("requireUser(mutating) rejects a foreign origin", async () => {
    const res = verifyCode("o@b.co", await codeFor("o@b.co"), "UA", Date.now());
    assert.ok(res.ok);
    if (!res.ok) return;
    const mk = (origin: string) =>
      new Request("http://localhost:3000/x", {
        method: "POST",
        headers: { cookie: `${SESSION_COOKIE}=${res.token}`, origin, host: "localhost:3000" },
      });
    assert.equal(requireUser(mk("http://localhost:3000"), { mutating: true }).ok, true);
    const bad = requireUser(mk("https://evil.example"), { mutating: true });
    assert.equal(bad.ok, false);
    if (!bad.ok) {
      assert.equal(bad.response.status, 403);
      assert.equal((await bad.response.json()).code, "bad_origin");
    }
  });

  it("isAdminEmail: unset means nobody, set is case-insensitive", () => {
    assert.equal(isAdminEmail("a@b.co"), false);
    process.env.ADMIN_EMAILS = "Boss@Example.com, other@example.com";
    assert.equal(isAdminEmail("boss@example.com"), true);
    assert.equal(isAdminEmail("OTHER@example.com"), true);
    assert.equal(isAdminEmail("a@b.co"), false);
  });

  it("session cookie is HttpOnly, Lax, Path=/ and Secure only in production", () => {
    const dev = sessionCookie("tok");
    assert.match(dev, /HttpOnly; SameSite=Lax; Path=\//);
    assert.doesNotMatch(dev, /Secure/);
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      assert.match(sessionCookie("tok"), /; Secure/);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    }
  });

  it("without a mail key in production, no code is stored or logged", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      const r = await requestCode("prod@b.co", freshIp(), T0);
      assert.deepEqual(r, { ok: false, status: 503, code: "mail_unavailable" });
    } finally {
      console.log = orig;
      (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    }
    assert.equal(lines.length, 0);
    assert.equal((db().prepare("SELECT COUNT(*) AS n FROM login_codes WHERE email = ?").get("prod@b.co") as { n: number }).n, 0);
  });
});
