import crypto from "node:crypto";
import type { ErrorCode } from "./api-types";
import { db } from "./db";
import { adminEmails, authSecret, isProduction } from "./env";
import { checkOrigin, jsonError } from "./http";
import { hit } from "./limits";
import { sendLoginCode } from "./mailer";

export type User = {
  id: number;
  email: string;
  displayName: string;
  avatarEmoji: string;
  createdAt: number;
  lastLoginAt: number;
};
export type AuthResult = { ok: true; user: User; sessionId: number } | { ok: false; response: Response };

export const SESSION_COOKIE = "dc_session";
const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 3600_000;
const SEEN_EVERY_MS = 3600_000;

export function normalizeEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

const codeHash = (email: string, code: string) =>
  crypto.createHmac("sha256", authSecret()).update(`code:${email}:${code}`).digest("hex");
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

type UserRow = {
  id: number;
  email: string;
  display_name: string;
  avatar_emoji: string;
  created_at: number;
  last_login_at: number;
};
const toUser = (r: UserRow): User => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  avatarEmoji: r.avatar_emoji,
  createdAt: r.created_at,
  lastLoginAt: r.last_login_at,
});

export async function requestCode(
  email: string,
  ip: string,
  now: number = Date.now()
): Promise<{ ok: true } | { ok: false; status: 400 | 429 | 503; code: ErrorCode; retryAfter?: number }> {
  const e = normalizeEmail(email);
  if (!e) return { ok: false, status: 400, code: "bad_request" };
  // Rate limits first, before a code is generated. The first limit that trips stops the check, so a
  // double click does not burn the hourly allowance. The IP limit goes first: once an address is
  // blocked it can no longer use up another person's per-email allowance.
  const checks: [string, number, number][] = [
    [`code:ip:${ip}`, 3600_000, 20],
    [`code:email:${e}:m`, 60_000, 1],
    [`code:email:${e}:h`, 3600_000, 5],
  ];
  for (const [key, windowMs, limit] of checks) {
    const r = hit(key, windowMs, limit, now);
    if (!r.ok) return { ok: false, status: 429, code: "rate_limited", retryAfter: r.retryAfter };
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  db()
    .prepare(
      `INSERT INTO login_codes (email, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at,
         attempts = 0, created_at = excluded.created_at`
    )
    .run(e, codeHash(e, code), now + CODE_TTL_MS, now);
  const sent = await sendLoginCode(e, code);
  if (sent === "unavailable") {
    db().prepare("DELETE FROM login_codes WHERE email = ?").run(e);
    return { ok: false, status: 503, code: "mail_unavailable" };
  }
  return { ok: true };
}

export function verifyCode(
  email: string,
  code: string,
  userAgent: string,
  now: number = Date.now()
): { ok: true; user: User; token: string } | { ok: false } {
  const e = normalizeEmail(email);
  if (!e) return { ok: false };
  const d = db();
  const row = d.prepare("SELECT * FROM login_codes WHERE email = ?").get(e) as
    | { code_hash: string; expires_at: number; attempts: number }
    | undefined;
  if (!row) return { ok: false };
  if (row.expires_at <= now || row.attempts >= MAX_ATTEMPTS) {
    d.prepare("DELETE FROM login_codes WHERE email = ?").run(e);
    return { ok: false };
  }
  const given = Buffer.from(codeHash(e, code.trim()), "hex");
  const expected = Buffer.from(row.code_hash, "hex");
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    if (row.attempts + 1 >= MAX_ATTEMPTS) d.prepare("DELETE FROM login_codes WHERE email = ?").run(e);
    else d.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?").run(e);
    return { ok: false };
  }
  return d.transaction(() => {
    d.prepare("DELETE FROM login_codes WHERE email = ?").run(e);
    let u = d.prepare("SELECT * FROM users WHERE email = ?").get(e) as UserRow | undefined;
    if (u) {
      d.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, u.id);
      u = { ...u, last_login_at: now };
    } else {
      const name = e.split("@")[0].slice(0, 40);
      const res = d
        .prepare("INSERT INTO users (email, display_name, avatar_emoji, created_at, last_login_at) VALUES (?, ?, '🎭', ?, ?)")
        .run(e, name, now, now);
      u = d.prepare("SELECT * FROM users WHERE id = ?").get(res.lastInsertRowid) as UserRow;
    }
    const token = crypto.randomBytes(32).toString("base64url");
    d.prepare(
      "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(sha256(token), u.id, now, now, now + SESSION_TTL_MS, userAgent.slice(0, 200));
    return { ok: true as const, user: toUser(u), token };
  })();
}

function tokenFrom(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) return part.slice(i + 1).trim() || null;
  }
  return null;
}

export function getSessionUser(req: Request, now: number = Date.now()): { user: User; sessionId: number } | null {
  const token = tokenFrom(req);
  if (!token) return null;
  const d = db();
  const row = d
    .prepare(
      `SELECT s.id AS sid, s.expires_at, s.last_seen_at, u.* FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`
    )
    .get(sha256(token)) as (UserRow & { sid: number; expires_at: number; last_seen_at: number }) | undefined;
  if (!row) return null;
  if (row.expires_at <= now) {
    d.prepare("DELETE FROM sessions WHERE id = ?").run(row.sid);
    return null;
  }
  if (now - row.last_seen_at >= SEEN_EVERY_MS) {
    d.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, row.sid);
  }
  return { user: toUser(row), sessionId: row.sid };
}

export function requireUser(req: Request, opts: { mutating?: boolean } = {}): AuthResult {
  if (opts.mutating) {
    const bad = checkOrigin(req);
    if (bad) return { ok: false, response: bad };
  }
  const s = getSessionUser(req);
  if (!s) return { ok: false, response: jsonError(401, "unauthorized", "Please sign in.") };
  return { ok: true, user: s.user, sessionId: s.sessionId };
}

export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(email.trim().toLowerCase());
}

export function requireAdmin(req: Request): AuthResult {
  const auth = requireUser(req, { mutating: true });
  if (!auth.ok) return auth;
  if (!isAdminEmail(auth.user.email)) {
    return { ok: false, response: jsonError(403, "not_admin", "Only admins can do that.") };
  }
  return auth;
}

export function signOut(token: string): void {
  db().prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

/** Signs out the session named by the request's cookie, if any. */
export function signOutRequest(req: Request): void {
  const t = tokenFrom(req);
  if (t) signOut(t);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${isProduction() ? "; Secure" : ""}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${isProduction() ? "; Secure" : ""}`;
}
