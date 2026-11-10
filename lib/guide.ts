/** The story guide's quota: free uses per day, then one completed guide ad per guide. Server only. */
import type { GuideQuota } from "./api-types";
import { guideCredits } from "./ads";
import { db } from "./db";
import { dayKey, nextDayStart } from "./day";
import { guideFreePerDay } from "./env";
import { hitUntil, peek } from "./limits";
import type { AdvanceGuide } from "./schema";

const freeKey = (userId: number, now: number) => `guide_free:${userId}:${dayKey(now)}`;

export function guideQuota(userId: number, now: number = Date.now()): GuideQuota {
  return {
    freeLeftToday: Math.max(0, guideFreePerDay() - peek(freeKey(userId, now), now)),
    credits: guideCredits(userId),
    resetsAt: nextDayStart(now),
  };
}

export type RunGuideResult =
  | { ok: true; guide: AdvanceGuide; source: "free" | "credit"; quota: GuideQuota }
  | { ok: false; status: 402 | 502; code: "needs_ad" | "llm_failed"; resetsAt?: number };

/**
 * Pre-checks the quota (read only), writes the guide, and only then consumes the free use or the credit, in
 * one synchronous transaction that re-checks. A failed model call or a parallel request that took the last use
 * costs nothing.
 */
export async function runGuide(
  userId: number,
  generate: () => Promise<AdvanceGuide>,
  now: number = Date.now()
): Promise<RunGuideResult> {
  const needsAd = (): RunGuideResult => ({ ok: false, status: 402, code: "needs_ad", resetsAt: nextDayStart(now) });
  const before = guideQuota(userId, now);
  if (before.freeLeftToday <= 0 && before.credits <= 0) return needsAd();

  let guide: AdvanceGuide;
  try {
    guide = await generate();
  } catch (err) {
    console.error("Advance guide failed:", err instanceof Error ? err.message : err);
    return { ok: false, status: 502, code: "llm_failed" };
  }

  const source = db().transaction((): "free" | "credit" | null => {
    if (guideQuota(userId, now).freeLeftToday > 0) {
      hitUntil(freeKey(userId, now), nextDayStart(now), guideFreePerDay(), now);
      return "free";
    }
    const credit = db()
      .prepare(
        `SELECT id FROM ad_sessions WHERE user_id = ? AND reward_type = 'guide' AND status = 'completed' AND redeemed_at IS NULL
         ORDER BY completed_at, id LIMIT 1`
      )
      .get(userId) as { id: string } | undefined;
    if (!credit) return null;
    const r = db().prepare("UPDATE ad_sessions SET redeemed_at = ? WHERE id = ? AND redeemed_at IS NULL").run(now, credit.id);
    return r.changes === 1 ? "credit" : null;
  })();

  if (!source) return needsAd();
  return { ok: true, guide, source, quota: guideQuota(userId, now) };
}
