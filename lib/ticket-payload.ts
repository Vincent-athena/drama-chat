/** Isomorphic half of the save ticket: no node:crypto. The browser reads it for display only. */
export type TicketPayload = {
  v: 1;
  uid: number; // users.id
  sid: string; // story id
  r: string; // run id: 8 random bytes, base64url; new on every fresh ticket
  p: number; // phase index, 0..story.phases.length (== length means finished)
  f: string[]; // found item ids in this run, sorted, unique [WP3]
  iat: number; // issued-at, epoch ms
};

export function b64urlDecodeToString(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Checks the shape of a parsed payload. */
export function isTicketPayload(x: unknown): x is TicketPayload {
  if (!x || typeof x !== "object") return false;
  const t = x as Record<string, unknown>;
  return (
    t.v === 1 &&
    typeof t.uid === "number" && Number.isInteger(t.uid) &&
    typeof t.sid === "string" &&
    typeof t.r === "string" &&
    typeof t.p === "number" && Number.isInteger(t.p) && t.p >= 0 &&
    Array.isArray(t.f) && t.f.every((i) => typeof i === "string") &&
    typeof t.iat === "number"
  );
}

/** Reads the payload WITHOUT verifying. Client display only. null when malformed. */
export function decodeTicketPayload(ticket: string): TicketPayload | null {
  try {
    const parts = ticket.split(".");
    if (parts.length !== 2) return null;
    const parsed: unknown = JSON.parse(b64urlDecodeToString(parts[0]));
    return isTicketPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Which ticket the browser keeps. force=true (restart, import) always takes `incoming`. */
export function preferTicket(existing: string | null, incoming: string, force = false): string {
  if (force || !existing) return incoming;
  const a = decodeTicketPayload(existing);
  if (!a) return incoming;
  const b = decodeTicketPayload(incoming);
  if (!b) return existing;
  if (a.r !== b.r) return existing; // a stale reply from before a restart
  if (b.p !== a.p) return b.p > a.p ? incoming : existing;
  if (b.f.length !== a.f.length) return b.f.length > a.f.length ? incoming : existing;
  return incoming;
}
