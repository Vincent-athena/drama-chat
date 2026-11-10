import type { AdvanceGuide, ChatMessage, Group, TaggedMessage } from "@/lib/schema";

/** Contracts 4.3: the downloadable copy of a browser save. Rows are the raw IndexedDB rows. */
export type SaveFile = {
  format: "drama-chat-save";
  version: 1;
  exportedAt: number;
  userId: number;
  stores: {
    progress: unknown[];
    messages: unknown[];
    groups: unknown[];
    events: unknown[];
    notes: unknown[];
    guides: unknown[];
  };
};

export interface SaveStore {
  readonly userId: number;
  // progress
  getTicket(storyId: string): Promise<string | null>;
  setTicket(storyId: string, ticket: string, opts?: { force?: boolean }): Promise<void>; // uses preferTicket
  getPhaseIndex(storyId: string): Promise<number>; // decoded from the ticket, 0 when none (display only)
  listProgress(): Promise<{ storyId: string; phaseIndex: number; startedAt: number; updatedAt: number }[]>;
  // one-on-one
  getHistory(storyId: string, characterId: string, limit?: number): Promise<ChatMessage[]>; // default 200
  addMessage(storyId: string, characterId: string, msg: ChatMessage): Promise<void>;
  getRecentStoryMessages(storyId: string, limit?: number): Promise<TaggedMessage[]>; // default 30
  // groups
  createGroup(storyId: string, memberIds: string[]): Promise<Group>;
  getGroup(storyId: string, groupId: number): Promise<Group | null>;
  listGroups(storyId: string): Promise<Group[]>;
  getGroupHistory(storyId: string, groupId: number, limit?: number): Promise<TaggedMessage[]>; // default 200
  getGroupMessagesFor(storyId: string, characterId: string, limit?: number): Promise<TaggedMessage[]>; // default 20
  addGroupMessage(storyId: string, groupId: number, speakerId: string, msg: ChatMessage): Promise<void>;
  // director memory
  getEvents(storyId: string): Promise<string[]>;
  addEvent(storyId: string, phaseIndex: number, summary: string): Promise<void>;
  getChapterNotes(storyId: string, phaseIndex: number): Promise<string>;
  setChapterNotes(storyId: string, phaseIndex: number, notes: string): Promise<void>;
  // advance guide: the last one per chapter, reopened for free
  getGuide(storyId: string, phaseIndex: number): Promise<AdvanceGuide | null>; // null when none or invalid
  setGuide(storyId: string, phaseIndex: number, guide: AdvanceGuide): Promise<void>;
  // whole story
  resetStory(storyId: string): Promise<void>; // deletes messages, groups, events, notes, guides, progress of that story
  // whole save [WP2]
  countUserMessages(): Promise<number>; // messages the player sent (role "user"), all stories
  exportAll(): Promise<SaveFile>;
  importAll(file: SaveFile): Promise<void>; // replaces everything in one transaction
  destroy(): Promise<void>; // closes the connection and deletes the whole database
}
