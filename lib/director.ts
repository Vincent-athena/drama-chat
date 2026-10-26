import {
  addEvent,
  getChapterNotes,
  getPhaseIndex,
  getRecentStoryMessages,
  listGroups,
  setChapterNotes,
  setPhaseIndex,
} from "./db";
import { judgePhase } from "./deepseek";
import type { GroupMembers } from "./prompts";
import type { Story } from "./schema";
import { charactersUnlockedAt } from "./stories";

export function groupMembersOf(storyId: string): GroupMembers {
  return new Map(listGroups(storyId).map((g) => [g.id, g.memberIds]));
}

/** The final {"type":"done"} stream event, sent after the director has judged the turn. */
export type DoneEvent = {
  type: "done";
  phaseAdvanced: boolean;
  completedPhaseTitle?: string;
  eventSummary?: string;
  finished?: boolean;
  newPhase?: { title: string; narration: string; objective: string } | null;
  unlocked?: { id: string; name: string; avatarEmoji: string }[];
};

/** Asks the director whether the current chapter is complete and advances the story if so. */
export async function judgeTurn(story: Story, phaseIndex: number, events: string[]): Promise<DoneEvent> {
  if (phaseIndex >= story.phases.length) return { type: "done", phaseAdvanced: false };

  const verdict = await judgePhase(
    story,
    phaseIndex,
    getRecentStoryMessages(story.id),
    events,
    getChapterNotes(story.id, phaseIndex),
    groupMembersOf(story.id)
  );
  // Another request may have advanced the phase while this one was streaming.
  if (getPhaseIndex(story.id) !== phaseIndex) return { type: "done", phaseAdvanced: false };
  // An empty result means the judge failed; keep the old notes rather than wiping them.
  if (verdict.notes.trim()) setChapterNotes(story.id, phaseIndex, verdict.notes.trim());
  if (!verdict.completed) return { type: "done", phaseAdvanced: false };

  const next = phaseIndex + 1;
  addEvent(story.id, phaseIndex, verdict.eventSummary || `${story.phases[phaseIndex].title} was resolved.`);
  setPhaseIndex(story.id, next);
  const nextPhase = story.phases[next];
  return {
    type: "done",
    phaseAdvanced: true,
    completedPhaseTitle: story.phases[phaseIndex].title,
    eventSummary: verdict.eventSummary,
    finished: !nextPhase,
    newPhase: nextPhase
      ? { title: nextPhase.title, narration: nextPhase.narration, objective: nextPhase.objective }
      : null,
    unlocked: nextPhase
      ? charactersUnlockedAt(story, next).map((c) => ({ id: c.id, name: c.name, avatarEmoji: c.avatarEmoji }))
      : [],
  };
}
