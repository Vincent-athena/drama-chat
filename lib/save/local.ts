/** The browser's save: one IndexedDB per signed-in user. Browser only; touch it from effects and handlers. */
import { AdvanceGuideSchema, type AdvanceGuide, type ChatMessage, type Group, type TaggedMessage } from "@/lib/schema";
import { decodeTicketPayload, preferTicket } from "@/lib/ticket-payload";
import { closeDb, collect, openDb, req, withTx } from "./idb";
import type { SaveFile, SaveStore } from "./types";

const FILE_STORES = ["progress", "messages", "groups", "events", "notes", "guides"] as const;

type MessageRow = {
  id: number;
  storyId: string;
  chat: string; // "c:<characterId>" or "g:<groupId>"
  characterId: string;
  groupId: number | null;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};
type ProgressRow = { storyId: string; ticket: string; startedAt: number; updatedAt: number };
type GroupRow = { id: number; storyId: string; memberIds: string[]; createdAt: number };
type EventRow = { id: number; storyId: string; phaseIndex: number; summary: string; createdAt: number };
type NotesRow = { storyId: string; phaseIndex: number; notes: string; updatedAt: number };

const tagged = (m: MessageRow): TaggedMessage => ({
  role: m.role,
  content: m.content,
  characterId: m.characterId,
  groupId: m.groupId,
});
const plain = (m: MessageRow): ChatMessage => ({ role: m.role, content: m.content });
const toGroup = (g: GroupRow): Group => ({ id: g.id, storyId: g.storyId, memberIds: g.memberIds });

export const dbNameFor = (userId: number) => `drama-chat:u${userId}`;

export class LocalSaveStore implements SaveStore {
  constructor(readonly userId: number) {}

  private db() {
    return openDb(dbNameFor(this.userId));
  }

  // ---- progress
  async getTicket(storyId: string): Promise<string | null> {
    const db = await this.db();
    const row = await withTx(db, ["progress"], "readonly", (tx) =>
      req<ProgressRow | undefined>(tx.objectStore("progress").get(storyId))
    );
    return row?.ticket ?? null;
  }

  async setTicket(storyId: string, ticket: string, opts: { force?: boolean } = {}): Promise<void> {
    const db = await this.db();
    const now = Date.now();
    await withTx(db, ["progress"], "readwrite", async (tx) => {
      const store = tx.objectStore("progress");
      const existing = await req<ProgressRow | undefined>(store.get(storyId));
      const kept = preferTicket(existing?.ticket ?? null, ticket, opts.force);
      if (existing && kept === existing.ticket) return;
      await req(
        store.put({
          storyId,
          ticket: kept,
          startedAt: opts.force || !existing ? now : existing.startedAt,
          updatedAt: now,
        } satisfies ProgressRow)
      );
    });
  }

  async getPhaseIndex(storyId: string): Promise<number> {
    const t = await this.getTicket(storyId);
    return (t && decodeTicketPayload(t)?.p) || 0;
  }

  async listProgress() {
    const db = await this.db();
    const rows = await withTx(db, ["progress"], "readonly", (tx) =>
      collect<ProgressRow>(tx.objectStore("progress"), undefined)
    );
    return rows.map((r) => ({
      storyId: r.storyId,
      phaseIndex: decodeTicketPayload(r.ticket)?.p ?? 0,
      startedAt: r.startedAt,
      updatedAt: r.updatedAt,
    }));
  }

  // ---- one-on-one
  async getHistory(storyId: string, characterId: string, limit = 200): Promise<ChatMessage[]> {
    const db = await this.db();
    const rows = await withTx(db, ["messages"], "readonly", (tx) =>
      collect<MessageRow>(tx.objectStore("messages").index("byChat"), [storyId, `c:${characterId}`], "prev", limit)
    );
    return rows.reverse().map(plain);
  }

  async addMessage(storyId: string, characterId: string, msg: ChatMessage): Promise<void> {
    const db = await this.db();
    await withTx(db, ["messages"], "readwrite", async (tx) => {
      await req(
        tx.objectStore("messages").add({
          storyId,
          chat: `c:${characterId}`,
          characterId,
          groupId: null,
          role: msg.role,
          content: msg.content,
          createdAt: Date.now(),
        } satisfies Omit<MessageRow, "id">)
      );
    });
  }

  async getRecentStoryMessages(storyId: string, limit = 30): Promise<TaggedMessage[]> {
    const db = await this.db();
    const rows = await withTx(db, ["messages"], "readonly", (tx) =>
      collect<MessageRow>(tx.objectStore("messages").index("byStory"), storyId, "prev", limit)
    );
    return rows.reverse().map(tagged);
  }

  // ---- groups
  async createGroup(storyId: string, memberIds: string[]): Promise<Group> {
    const db = await this.db();
    const id = await withTx(db, ["groups"], "readwrite", (tx) =>
      req(tx.objectStore("groups").add({ storyId, memberIds, createdAt: Date.now() }))
    );
    return { id: Number(id), storyId, memberIds };
  }

  async getGroup(storyId: string, groupId: number): Promise<Group | null> {
    const db = await this.db();
    const row = await withTx(db, ["groups"], "readonly", (tx) =>
      req<GroupRow | undefined>(tx.objectStore("groups").get(groupId))
    );
    return row && row.storyId === storyId ? toGroup(row) : null;
  }

  async listGroups(storyId: string): Promise<Group[]> {
    const db = await this.db();
    const rows = await withTx(db, ["groups"], "readonly", (tx) =>
      collect<GroupRow>(tx.objectStore("groups").index("byStory"), storyId)
    );
    return rows.map(toGroup);
  }

  async getGroupHistory(storyId: string, groupId: number, limit = 200): Promise<TaggedMessage[]> {
    const db = await this.db();
    const rows = await withTx(db, ["messages"], "readonly", (tx) =>
      collect<MessageRow>(tx.objectStore("messages").index("byChat"), [storyId, `g:${groupId}`], "prev", limit)
    );
    return rows.reverse().map(tagged);
  }

  async getGroupMessagesFor(storyId: string, characterId: string, limit = 20): Promise<TaggedMessage[]> {
    const db = await this.db();
    const rows = await withTx(db, ["groups", "messages"], "readonly", async (tx) => {
      const groups = await collect<GroupRow>(tx.objectStore("groups").index("byStory"), storyId);
      const ids = new Set(groups.filter((g) => g.memberIds.includes(characterId)).map((g) => g.id));
      if (ids.size === 0) return [];
      return collect<MessageRow>(
        tx.objectStore("messages").index("byStory"),
        storyId,
        "prev",
        limit,
        (m) => m.groupId !== null && ids.has(m.groupId)
      );
    });
    return rows.reverse().map(tagged);
  }

  async addGroupMessage(storyId: string, groupId: number, speakerId: string, msg: ChatMessage): Promise<void> {
    const db = await this.db();
    await withTx(db, ["messages"], "readwrite", async (tx) => {
      await req(
        tx.objectStore("messages").add({
          storyId,
          chat: `g:${groupId}`,
          characterId: speakerId,
          groupId,
          role: msg.role,
          content: msg.content,
          createdAt: Date.now(),
        } satisfies Omit<MessageRow, "id">)
      );
    });
  }

  // ---- director memory
  async getEvents(storyId: string): Promise<string[]> {
    const db = await this.db();
    const rows = await withTx(db, ["events"], "readonly", (tx) =>
      collect<EventRow>(tx.objectStore("events").index("byStory"), storyId)
    );
    return rows.map((e) => e.summary);
  }

  async addEvent(storyId: string, phaseIndex: number, summary: string): Promise<void> {
    const db = await this.db();
    await withTx(db, ["events"], "readwrite", async (tx) => {
      await req(tx.objectStore("events").add({ storyId, phaseIndex, summary, createdAt: Date.now() }));
    });
  }

  async getChapterNotes(storyId: string, phaseIndex: number): Promise<string> {
    const db = await this.db();
    const row = await withTx(db, ["notes"], "readonly", (tx) =>
      req<NotesRow | undefined>(tx.objectStore("notes").get([storyId, phaseIndex]))
    );
    return row?.notes ?? "";
  }

  async setChapterNotes(storyId: string, phaseIndex: number, notes: string): Promise<void> {
    const db = await this.db();
    await withTx(db, ["notes"], "readwrite", async (tx) => {
      await req(tx.objectStore("notes").put({ storyId, phaseIndex, notes, updatedAt: Date.now() } satisfies NotesRow));
    });
  }

  // ---- advance guide
  async getGuide(storyId: string, phaseIndex: number): Promise<AdvanceGuide | null> {
    const db = await this.db();
    const row = await withTx(db, ["guides"], "readonly", (tx) =>
      req<{ guide: unknown } | undefined>(tx.objectStore("guides").get([storyId, phaseIndex]))
    );
    const parsed = AdvanceGuideSchema.safeParse(row?.guide);
    return row && parsed.success ? parsed.data : null;
  }

  async setGuide(storyId: string, phaseIndex: number, guide: AdvanceGuide): Promise<void> {
    const db = await this.db();
    await withTx(db, ["guides"], "readwrite", async (tx) => {
      await req(tx.objectStore("guides").put({ storyId, phaseIndex, guide, createdAt: Date.now() }));
    });
  }

  // ---- whole story
  async resetStory(storyId: string): Promise<void> {
    const db = await this.db();
    await withTx(db, ["progress", "messages", "groups", "events", "notes", "guides"], "readwrite", async (tx) => {
      await req(tx.objectStore("progress").delete(storyId));
      for (const name of ["messages", "groups", "events"] as const) {
        const store = tx.objectStore(name);
        const keys = await req(store.index("byStory").getAllKeys(storyId));
        for (const k of keys) await req(store.delete(k));
      }
      const range = IDBKeyRange.bound([storyId, -Infinity], [storyId, Infinity]);
      await req(tx.objectStore("notes").delete(range));
      await req(tx.objectStore("guides").delete(range));
    });
  }

  // ---- whole save
  async countUserMessages(): Promise<number> {
    const db = await this.db();
    const rows = await withTx(db, ["messages"], "readonly", (tx) =>
      collect<MessageRow>(tx.objectStore("messages"), undefined, "next", Infinity, (m) => m.role === "user")
    );
    return rows.length;
  }

  async exportAll(): Promise<SaveFile> {
    const db = await this.db();
    const stores = await withTx(db, [...FILE_STORES], "readonly", async (tx) => {
      const out: Record<string, unknown[]> = {};
      for (const name of FILE_STORES) out[name] = await req(tx.objectStore(name).getAll());
      return out;
    });
    return {
      format: "drama-chat-save",
      version: 1,
      exportedAt: Date.now(),
      userId: this.userId,
      stores: stores as SaveFile["stores"],
    };
  }

  /** The file must already be parsed and checked (parseSaveFile). Clears every store, then puts the rows back. */
  async importAll(file: SaveFile): Promise<void> {
    const db = await this.db();
    await withTx(db, [...FILE_STORES], "readwrite", async (tx) => {
      for (const name of FILE_STORES) await req(tx.objectStore(name).clear());
      for (const name of FILE_STORES) {
        const store = tx.objectStore(name);
        for (const row of file.stores[name]) await req(store.put(row));
      }
    });
  }

  async destroy(): Promise<void> {
    const name = dbNameFor(this.userId);
    await closeDb(name);
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      // "blocked" means another tab still holds it open. That tab closes on versionchange and the delete then
      // completes on its own, so do not keep the caller (account deletion) waiting for it.
      r.onblocked = () => resolve();
    });
  }
}
