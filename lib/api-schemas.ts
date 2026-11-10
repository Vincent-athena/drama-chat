/** zod schemas for request bodies. Isomorphic. Arrays over the caps are rejected, not truncated. */
import { z } from "zod";
import { CONTEXT_LIMITS as L } from "./limits-shared";

const content = z.string().max(L.contentChars);
const ChatMessageSchema = z.object({ role: z.enum(["user", "assistant"]), content });
const TaggedMessageSchema = ChatMessageSchema.extend({
  characterId: z.string().max(100),
  groupId: z.number().int().nullable(),
});

const JudgeContextSchema = z.object({
  recent: z.array(TaggedMessageSchema).max(L.recent),
  events: z.array(z.string().max(L.eventChars)).max(L.events),
  notes: z.string().max(L.notesChars),
  groupMembers: z
    .record(z.string(), z.array(z.string().max(100)).max(L.groupMembers))
    .refine((r) => Object.keys(r).length <= L.groups, "too many groups"),
});

export const ChatContextSchema = JudgeContextSchema.extend({
  history: z.array(ChatMessageSchema).max(L.history),
  groupChats: z.array(TaggedMessageSchema).max(L.groupChats),
});

export const GroupContextSchema = JudgeContextSchema.extend({
  history: z.array(TaggedMessageSchema).max(L.groupHistory),
  privateChats: z
    .record(z.string(), z.array(ChatMessageSchema).max(L.privateChat))
    .refine((r) => Object.keys(r).length <= L.groupMembers, "too many private chats"),
});

const message = z.string().trim().min(1, "Message is empty").max(L.messageChars);

const showItemId = z.string().max(100).optional();

export const ChatTurnBodySchema = z.object({ message, showItemId, context: ChatContextSchema });

export const GroupTurnBodySchema = z.object({
  message,
  showItemId,
  group: z.object({
    id: z.number().int(),
    memberIds: z.array(z.string().max(100)).min(2).max(L.groupMembers),
  }),
  context: GroupContextSchema,
});

export const ItemsBodySchema = z.object({
  tickets: z.record(z.string().max(200), z.string().max(4000)).refine((r) => Object.keys(r).length <= 100, "too many tickets"),
});

export const RequestCodeBodySchema = z.object({ email: z.string().max(300) });
export const VerifyBodySchema = z.object({ email: z.string().max(300), code: z.string().max(20) });

export const GenerateBodySchema = z.object({
  premise: z.string().optional(),
  numPhases: z.number().optional(),
  numCharacters: z.number().optional(),
});

export { ProfilePatchSchema, DeleteAccountSchema } from "./profile";
