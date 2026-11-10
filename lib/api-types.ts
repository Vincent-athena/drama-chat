/** Request/response/stream types shared by the server routes and the browser. Types only. */
import type { AdvanceGuide, ChatMessage, PublicCharacter, TaggedMessage } from "./schema";

export type ErrorCode =
  | "unauthorized" | "forbidden" | "not_admin" | "locked" | "bad_origin" | "item_not_owned" // 401/403
  | "not_found" | "bad_request" | "ticket_invalid" | "invalid_code"                         // 404/400
  | "needs_ad"                                                                               // 402 [WP4]
  | "conflict" | "too_early" | "already_owned" | "used"                                      // 409
  | "too_large"                                                                              // 413
  | "rate_limited" | "daily_cap" | "ad_cap"                                                  // 429
  | "llm_failed" | "no_api_key" | "mail_unavailable";                                        // 502/503
export type ApiErrorBody = { error: string; code: ErrorCode; retryAfter?: number /* s */; resetsAt?: number /* ms */ };

export type MeUser = { id: number; email: string; displayName: string; avatarEmoji: string; createdAt: number };
export type MeResponse = {
  user: MeUser | null;
  isAdmin: boolean;
  hasApiKey: boolean;
  messages: { usedToday: number; cap: number; resetsAt: number } | null; // null for guests
  guide?: GuideQuota | null; // null for guests
};

export type GuideQuota = { freeLeftToday: number; credits: number; resetsAt: number };
export type AdStartBody = { rewardType: "item"; storyId: string; itemId: string } | { rewardType: "guide"; storyId: string };
export type AdSessionView = { id: string; provider: "standin"; rewardType: "item" | "guide"; minSeconds: number; startedAt: number };
export type AdReward = { type: "item"; storyId: string; item: PublicItem } | { type: "guide"; quota: GuideQuota };
export type GuideResponse = { guide: AdvanceGuide; source: "free" | "credit"; quota: GuideQuota };

export type SessionView = { id: number; userAgent: string; createdAt: number; lastSeenAt: number; current: boolean };

export type StorySummary = { id: string; title: string; synopsis: string; phaseCount: number; characterCount: number };
export type PublicPhase = { id: string; title: string; narration: string; objective: string; hint: string; requiredItemIds: string[] };
export type PublicStory = {
  id: string;
  title: string;
  synopsis: string;
  setting: string;
  tone: string;
  phaseIndex: number;
  phaseCount: number;
  finished: boolean;
  currentPhase: PublicPhase | null;
  pastPhases: PublicPhase[];
  characters: PublicCharacter[];
  items: PublicItem[];
};

/** Never carries obtainCriteria. Items from a later chapter are left out unless owned. */
export type PublicItem = {
  id: string;
  name: string;
  emoji: string;
  source: "start" | "found" | "ad";
  description: string; // "" for a found item not owned yet
  availablePhaseIndex: number;
  owned: boolean;
};
/** POST /api/items: the owned items of one story. */
export type OwnedStoryItems = { storyId: string; title: string; items: PublicItem[] };

export type JudgeContext = {
  recent: TaggedMessage[]; // story-wide, oldest first, BEFORE this turn
  events: string[];
  notes: string; // director notes of the current chapter
  groupMembers: Record<string, string[]>; // groupId -> memberIds
};
export type ChatContext = JudgeContext & {
  history: ChatMessage[]; // this character's one-on-one chat
  groupChats: TaggedMessage[]; // from groups this character is in
};
export type GroupContext = JudgeContext & {
  history: TaggedMessage[]; // this group
  privateChats: Record<string, ChatMessage[]>; // memberId -> one-on-one chat
};

export type ChatTurnBody = { message: string; showItemId?: string; context: ChatContext };
export type GroupTurnBody = { message: string; showItemId?: string; group: { id: number; memberIds: string[] }; context: GroupContext };

export type DoneEvent = {
  type: "done";
  ticket: string; // always present; store with setTicket (no force)
  phaseIndex: number; // the chapter this turn was judged in
  notes: string | null; // new director notes for `phaseIndex`; null = keep the old ones
  phaseAdvanced: boolean;
  completedPhaseTitle?: string;
  eventSummary?: string;
  finished?: boolean;
  newPhase?: { title: string; narration: string; objective: string } | null;
  unlocked?: { id: string; name: string; avatarEmoji: string }[];
  itemsFound: PublicItem[]; // items the player obtained this turn
  blockedByItemIds?: string[]; // the judge said complete but these required items are missing
};
export type StreamEvent =
  | { type: "speaker"; characterId: string }
  | { type: "delta"; text: string }
  | { type: "replied" }
  | DoneEvent
  | { type: "error"; message: string; code?: "llm_failed" };
