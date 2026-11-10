import crypto from "node:crypto";
import { authSecret } from "./env";
import type { Story } from "./schema";
import { isTicketPayload, type TicketPayload } from "./ticket-payload";

export class TicketError extends Error {
  constructor(public reason: "missing" | "malformed" | "signature" | "user" | "story" | "range") {
    super(`ticket ${reason}`);
  }
}

const mac = (payloadPart: string) =>
  crypto.createHmac("sha256", authSecret()).update("ticket.v1." + payloadPart).digest();

export function signTicket(p: Omit<TicketPayload, "v" | "iat">, now: number = Date.now()): string {
  const payload: TicketPayload = { v: 1, uid: p.uid, sid: p.sid, r: p.r, p: p.p, f: p.f, iat: now };
  const part = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${part}.${mac(part).toString("base64url")}`;
}

export function freshTicket(uid: number, sid: string, now: number = Date.now()): string {
  return signTicket({ uid, sid, r: crypto.randomBytes(8).toString("base64url"), p: 0, f: [] }, now);
}

export function verifyTicket(ticket: string | null, uid: number, story: Story): TicketPayload {
  if (!ticket) throw new TicketError("missing");
  const parts = ticket.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new TicketError("malformed");
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new TicketError("malformed");
  }
  if (!isTicketPayload(payload)) throw new TicketError("malformed");
  const given = Buffer.from(parts[1], "base64url");
  const expected = mac(parts[0]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new TicketError("signature");
  if (payload.uid !== uid) throw new TicketError("user");
  if (payload.sid !== story.id) throw new TicketError("story");
  // Found items arrive with WP3; until then `f` must be empty.
  if (payload.p > story.phases.length || payload.f.length > 0) throw new TicketError("range");
  return payload;
}

export function reissue(t: TicketPayload, change: { p?: number; f?: string[] }, now: number = Date.now()): string {
  return signTicket({ uid: t.uid, sid: t.sid, r: t.r, p: change.p ?? t.p, f: change.f ?? t.f }, now);
}
