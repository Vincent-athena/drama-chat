/** Shared pieces of the chat and group-chat handlers. Server only. */
import { jsonError } from "./http";
import { dailyMessageCap } from "./env";
import { dayKey, nextDayStart } from "./day";
import { hasApiKey, MissingApiKeyError } from "./llm";
import { hitUntil } from "./limits";
import type { Story } from "./schema";
import { isUnlocked } from "./stories";
import { TicketError, verifyTicket } from "./ticket";
import type { TicketPayload } from "./ticket-payload";
import { TICKET_HEADER, TICKET_INVALID_MESSAGE } from "./ticket-http";

/** Verifies the save ticket header; a Response is the 400 to return. */
export function ticketFrom(req: Request, uid: number, story: Story): { ok: true; t: TicketPayload; raw: string } | { ok: false; response: Response } {
  const raw = req.headers.get(TICKET_HEADER);
  try {
    return { ok: true, t: verifyTicket(raw, uid, story), raw: raw as string };
  } catch (err) {
    if (err instanceof TicketError) return { ok: false, response: jsonError(400, "ticket_invalid", TICKET_INVALID_MESSAGE) };
    throw err;
  }
}

export const lockedResponse = () => jsonError(403, "locked", "This character is still locked");

/** Characters must exist (404) and be unlocked at the ticket's chapter (403). */
export function charactersLocked(story: Story, ids: string[], phaseIndex: number): boolean {
  return ids.some((id) => {
    const c = story.characters.find((x) => x.id === id);
    return !c || !isUnlocked(story, c, phaseIndex);
  });
}

/** After validation, before the model call: API key (503), then the daily cap (429). Null = go ahead. */
export function admit(uid: number, now: number = Date.now()): Response | null {
  if (!hasApiKey()) return jsonError(503, "no_api_key", new MissingApiKeyError().message);
  const cap = dailyMessageCap();
  const resetsAt = nextDayStart(now);
  const r = hitUntil(`msg:${uid}:${dayKey(now)}`, resetsAt, cap, now);
  if (!r.ok) {
    return jsonError(
      429,
      "daily_cap",
      "You've used today's messages.",
      { resetsAt }
    );
  }
  return null;
}

export function groupMembersMap(rec: Record<string, string[]>): Map<number, string[]> {
  return new Map(Object.entries(rec).map(([k, v]) => [Number(k), v]));
}

export const NDJSON_HEADERS = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" };
