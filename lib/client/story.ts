/** Browser helpers shared by the story hub and the chat windows. */
import type { DoneEvent, PublicStory } from "@/lib/api-types";
import type { SaveStore } from "@/lib/save/types";
import { decodeTicketPayload } from "@/lib/ticket-payload";
import { apiFetch } from "./api";

/** Loads the secret-free story view for the stored save, and keeps the ticket the server answers with. */
export async function loadStoryView(
  store: SaveStore,
  storyId: string
): Promise<{ story: PublicStory; hasApiKey: boolean }> {
  const res = await apiFetch(`/api/stories/${storyId}`, { ticket: { store, storyId } });
  const d = (await res.json()) as { story: PublicStory; ticket: string; hasApiKey: boolean };
  await store.setTicket(storyId, d.ticket);
  return { story: d.story, hasApiKey: d.hasApiKey };
}

/** Restart: a fresh run id from the server, then the browser forgets everything about the story. */
export async function restartStory(store: SaveStore, storyId: string): Promise<void> {
  const res = await apiFetch(`/api/stories/${storyId}/reset`, { method: "POST" });
  const { ticket } = (await res.json()) as { ticket: string };
  await store.resetStory(storyId);
  await store.setTicket(storyId, ticket, { force: true });
}

/** The run id of the stored ticket, or null. */
export async function currentRun(store: SaveStore, storyId: string): Promise<string | null> {
  const t = await store.getTicket(storyId);
  return (t && decodeTicketPayload(t)?.r) || null;
}

/**
 * Applies a finished turn's `done` event to the save: ticket, director notes, chapter event.
 * Skipped when the story was restarted while the turn was running (the run id changed).
 */
export async function applyDone(store: SaveStore, storyId: string, sentRun: string | null, done: DoneEvent): Promise<void> {
  if ((await currentRun(store, storyId)) !== sentRun) return;
  await store.setTicket(storyId, done.ticket);
  if (done.notes !== null) await store.setChapterNotes(storyId, done.phaseIndex, done.notes);
  if (done.phaseAdvanced && done.eventSummary) await store.addEvent(storyId, done.phaseIndex, done.eventSummary);
}
