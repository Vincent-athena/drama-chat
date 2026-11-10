import type { MeResponse } from "./api-types";
import type { User } from "./auth";
import { isAdminEmail } from "./auth";
import { peek } from "./limits";
import { dayKey, nextDayStart } from "./day";
import { dailyMessageCap } from "./env";
import { hasApiKey } from "./llm";

export const msgKey = (uid: number, now: number = Date.now()) => `msg:${uid}:${dayKey(now)}`;

export function meResponse(user: User | null, now: number = Date.now()): MeResponse {
  return {
    user: user
      ? { id: user.id, email: user.email, displayName: user.displayName, avatarEmoji: user.avatarEmoji, createdAt: user.createdAt }
      : null,
    isAdmin: user ? isAdminEmail(user.email) : false,
    hasApiKey: hasApiKey(),
    messages: user ? { usedToday: Math.min(peek(msgKey(user.id, now), now), dailyMessageCap()), cap: dailyMessageCap(), resetsAt: nextDayStart(now) } : null,
  };
}
