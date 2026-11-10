/** Save file validation. Isomorphic: no IndexedDB here. */
import { z } from "zod";
import type { SaveFile } from "./types";

const num = z.number().finite();
const str = z.string();
const progress = z.object({ storyId: str, ticket: str, startedAt: num, updatedAt: num });
const message = z.object({
  id: z.number().int(), storyId: str, chat: str, characterId: str,
  groupId: z.number().int().nullable(), role: z.enum(["user", "assistant"]), content: str, createdAt: num,
}).refine((m) => m.chat === (m.groupId === null ? `c:${m.characterId}` : `g:${m.groupId}`), "chat does not match its group");
const group = z.object({ id: z.number().int(), storyId: str, memberIds: z.array(str), createdAt: num });
const event = z.object({ id: z.number().int(), storyId: str, phaseIndex: z.number().int(), summary: str, createdAt: num });
const notes = z.object({ storyId: str, phaseIndex: z.number().int(), notes: str, updatedAt: num });
const guide = z.object({ storyId: str, phaseIndex: z.number().int(), guide: z.unknown(), createdAt: num });

export const SaveFileSchema = z.object({
  format: z.literal("drama-chat-save"),
  version: z.literal(1),
  exportedAt: num,
  userId: z.number().int(),
  stores: z.object({
    progress: z.array(progress),
    messages: z.array(message),
    groups: z.array(group),
    events: z.array(event),
    notes: z.array(notes),
    guides: z.array(guide),
  }),
});

export function parseSaveFile(
  json: unknown,
  userId: number
): { ok: true; file: SaveFile } | { ok: false; error: string } {
  const parsed = SaveFileSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "Not a Drama Chat save file." };
  if (parsed.data.userId !== userId) return { ok: false, error: "This save belongs to another account." };
  return { ok: true, file: parsed.data as SaveFile };
}

export const saveFileName = (now: number = Date.now()) =>
  `drama-chat-save-${new Date(now).toISOString().slice(0, 10)}.json`;
