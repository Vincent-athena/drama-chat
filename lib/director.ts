import type { DoneEvent } from "./api-types";
import { judgePhase } from "./llm";
import type { GroupMembers } from "./prompts";
import type { Story, TaggedMessage } from "./schema";
import { charactersUnlockedAt } from "./stories";
import { reissue } from "./ticket";
import type { TicketPayload } from "./ticket-payload";

export type { DoneEvent };

/**
 * Asks the director whether the current chapter is complete. Stateless: everything it needs comes in
 * as arguments, and the new progress comes back as a reissued ticket.
 */
export async function judgeTurn(
  args: {
    story: Story;
    ticket: TicketPayload;
    ticketString?: string;
    recent: TaggedMessage[];
    events: string[];
    notes: string;
    groupMembers: GroupMembers;
  },
  judge: typeof judgePhase = judgePhase
): Promise<DoneEvent> {
  const { story, ticket: t, recent, events, notes, groupMembers } = args;
  const echo = () => args.ticketString ?? reissue(t, {});
  const p = t.p;

  if (p >= story.phases.length) {
    return { type: "done", ticket: echo(), phaseIndex: p, notes: null, phaseAdvanced: false, itemsFound: [] };
  }

  const verdict = await judge(story, p, recent, events, notes, groupMembers);
  // An empty result means the judge failed; null tells the browser to keep its old notes.
  const newNotes = verdict.notes.trim() || null;
  if (!verdict.completed) {
    return { type: "done", ticket: echo(), phaseIndex: p, notes: newNotes, phaseAdvanced: false, itemsFound: [] };
  }

  const next = p + 1;
  const nextPhase = story.phases[next];
  return {
    type: "done",
    ticket: reissue(t, { p: next }),
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
    itemsFound: [],
  };
}
