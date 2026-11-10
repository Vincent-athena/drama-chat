/** Browser helper: the player's owned items across stories. */
import type { OwnedStoryItems } from "@/lib/api-types";
import type { SaveStore } from "@/lib/save/types";
import { apiFetch } from "./api";

/** Sends every stored ticket; the server answers with the owned items only (ad items need no ticket). */
export async function loadOwnedItems(store: SaveStore): Promise<OwnedStoryItems[]> {
  const tickets: Record<string, string> = {};
  for (const row of await store.listProgress()) {
    const t = await store.getTicket(row.storyId);
    if (t) tickets[row.storyId] = t;
  }
  const res = await apiFetch("/api/items", { method: "POST", json: { tickets } });
  return ((await res.json()) as { stories: OwnedStoryItems[] }).stories;
}
