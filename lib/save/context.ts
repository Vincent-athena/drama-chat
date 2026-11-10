/** Builds the context bodies the server expects, from the browser's save, and fits them under the caps. */
import type { ChatContext, GroupContext, JudgeContext } from "@/lib/api-types";
import { CONTEXT_LIMITS as L } from "@/lib/limits-shared";
import type { Group } from "@/lib/schema";
import type { SaveStore } from "./types";

const MAX_BYTES = 240_000;

async function judgeParts(store: SaveStore, storyId: string, phaseIndex: number): Promise<JudgeContext> {
  const [recent, events, notes, groups] = await Promise.all([
    store.getRecentStoryMessages(storyId, L.recent),
    store.getEvents(storyId),
    store.getChapterNotes(storyId, phaseIndex),
    store.listGroups(storyId),
  ]);
  const groupMembers: Record<string, string[]> = {};
  // Keep the newest groups if there are too many.
  for (const g of groups.slice(-L.groups)) groupMembers[String(g.id)] = g.memberIds.slice(0, L.groupMembers);
  return { recent, events: events.slice(-L.events), notes, groupMembers };
}

export async function judgeContext(store: SaveStore, storyId: string, phaseIndex: number): Promise<JudgeContext> {
  return fitContext(await judgeParts(store, storyId, phaseIndex));
}

export async function chatContext(
  store: SaveStore,
  storyId: string,
  characterId: string
): Promise<ChatContext> {
  const phaseIndex = await store.getPhaseIndex(storyId);
  const [base, history, groupChats] = await Promise.all([
    judgeParts(store, storyId, phaseIndex),
    store.getHistory(storyId, characterId, L.history),
    store.getGroupMessagesFor(storyId, characterId, L.groupChats),
  ]);
  return fitContext({ ...base, history, groupChats });
}

export async function groupContext(
  store: SaveStore,
  storyId: string,
  group: Group
): Promise<GroupContext> {
  const phaseIndex = await store.getPhaseIndex(storyId);
  const [base, history, privates] = await Promise.all([
    judgeParts(store, storyId, phaseIndex),
    store.getGroupHistory(storyId, group.id, L.groupHistory),
    Promise.all(group.memberIds.map(async (m) => [m, await store.getHistory(storyId, m, L.privateChat)] as const)),
  ]);
  return fitContext({ ...base, history, privateChats: Object.fromEntries(privates) });
}

const clip = <M extends { content: string }>(m: M): M =>
  m.content.length > L.contentChars ? { ...m, content: m.content.slice(0, L.contentChars) } : m;

const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * Truncates every message to the content cap, then drops the oldest entries of recent / groupChats /
 * privateChats (and history) until the JSON is under 240 000 bytes.
 */
export function fitContext<T>(ctx: T): T {
  const c = structuredClone(ctx) as Record<string, unknown>;
  const lists: { get(): { content: string }[]; set(v: { content: string }[]): void }[] = [];

  for (const key of ["recent", "history", "groupChats"]) {
    const arr = c[key] as { content: string }[] | undefined;
    if (!Array.isArray(arr)) continue;
    c[key] = arr.map(clip);
    lists.push({ get: () => c[key] as { content: string }[], set: (v) => (c[key] = v) });
  }
  const priv = c.privateChats as Record<string, { content: string }[]> | undefined;
  if (priv) {
    for (const k of Object.keys(priv)) {
      priv[k] = priv[k].map(clip);
      lists.push({ get: () => priv[k], set: (v) => (priv[k] = v) });
    }
  }
  if (typeof c.notes === "string" && c.notes.length > L.notesChars) c.notes = c.notes.slice(0, L.notesChars);
  if (Array.isArray(c.events)) {
    c.events = (c.events as string[]).slice(-L.events).map((e) => (e.length > L.eventChars ? e.slice(0, L.eventChars) : e));
  }

  // Drop the oldest entry of whichever list is currently longest, until it fits.
  while (size(c) >= MAX_BYTES) {
    let longest = lists[0];
    for (const l of lists) if (l.get().length > longest.get().length) longest = l;
    if (!longest || longest.get().length === 0) break;
    longest.set(longest.get().slice(1));
  }
  return c as T;
}
