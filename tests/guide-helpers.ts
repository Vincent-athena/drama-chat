import { parseSaveFile } from "../lib/save/file";

export function saveFileOk(guide: unknown): boolean {
  const file = {
    format: "drama-chat-save", version: 1, exportedAt: 1, userId: 1,
    stores: { progress: [], messages: [], groups: [], events: [], notes: [], guides: [{ storyId: "s", phaseIndex: 0, guide, createdAt: 1 }] },
  };
  return parseSaveFile(file, 1).ok;
}
