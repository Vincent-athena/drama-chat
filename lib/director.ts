import type { DoneEvent } from "./api-types";
import { findableItems, missingRequired, toPublicItems } from "./items";
import { judgePhase } from "./llm";
import type { GroupMembers } from "./prompts";
import type { Story, TaggedMessage } from "./schema";
import { charactersUnlockedAt } from "./stories";
import { reissue } from "./ticket";
import type { TicketPayload } from "./ticket-payload";

export type { DoneEvent };

/**
 * Asks the director whether the current chapter is complete and which found items the player obtained.
 * Stateless: everything it needs comes in as arguments, and the new progress comes back as a reissued ticket.
 */
export async function judgeTurn(
  args: {
    story: Story;
    ticket: TicketPayload;
    ticketString?: string;
    /** Owned item ids (start ∪ ticket ∪ ad rows). Defaults to the start items. */
    owned?: Set<string>;
    recent: TaggedMessage[];
    events: string[];
    notes: string;
    groupMembers: GroupMembers;
  },
  judge: typeof judgePhase = judgePhase
): Promise<DoneEvent> {
  const { story, ticket: t, recent, events, notes, groupMembers } = args;
  const ownedNow = args.owned ?? new Set(story.items.filter((i) => i.source === "start").map((i) => i.id));
  const echo = () => args.ticketString ?? reissue(t, {});
  const p = t.p;

  if (p >= story.phases.length) {
    return { type: "done", ticket: echo(), phaseIndex: p, notes: null, phaseAdvanced: false, itemsFound: [] };
  }

  const verdict = await judge(story, p, recent, events, notes, groupMembers, ownedNow);
  // An empty result means the judge failed; null tells the browser to keep its old notes.
  const newNotes = verdict.notes.trim() || null;

  // 1. Only items that can be found right now count; anything else the judge names is ignored.
  const findable = new Set(findableItems(story, p, ownedNow).map((i) => i.id));
  const granted = [...new Set(verdict.grantedItemIds)].filter((id) => findable.has(id));
  const owned = new Set([...ownedNow, ...granted]);
  const f = granted.length ? [...new Set([...t.f, ...granted])].sort() : t.f;
  const itemsFound = toPublicItems(story, p, owned).filter((i) => granted.includes(i.id));
  const ticketFor = (change: { p?: number }) => (granted.length || change.p !== undefined ? reissue(t, { ...change, f }) : echo());

  if (!verdict.completed) {
    return { type: "done", ticket: ticketFor({}), phaseIndex: p, notes: newNotes, phaseAdvanced: false, itemsFound };
  }

  // 2. The chapter cannot close while a required item is missing.
  const missing = missingRequired(story, p, owned);
  if (missing.length) {
    return { type: "done", ticket: ticketFor({}), phaseIndex: p, notes: newNotes, phaseAdvanced: false, itemsFound, blockedByItemIds: missing };
  }

  // 3. Advance.
  const next = p + 1;
  const nextPhase = story.phases[next];
  return {
    type: "done",
    ticket: ticketFor({ p: next }),
    phaseIndex: p,
    notes: newNotes,
    phaseAdvanced: true,
    completedPhaseTitle: story.phases[p].title,
    eventSummary: verdict.eventSummary || `${story.phases[p].title} was resolved.`,
    finished: !nextPhase,
    newPhase: nextPhase
      ? { title: nextPhase.title, narration: nextPhase.narration, objective: nextPhase.objective }
      : null,
    unlocked: nextPhase
      ? charactersUnlockedAt(story, next).map((c) => ({ id: c.id, name: c.name, avatarEmoji: c.avatarEmoji }))
      : [],
    itemsFound,
  };
}
