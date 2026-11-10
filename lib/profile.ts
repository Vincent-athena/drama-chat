/** Profile rules shared by the server (validation) and the browser (picker). Isomorphic. */
import { z } from "zod";

export const AVATAR_EMOJIS = ["🎭","🕵️","🦊","🐉","👑","🗝️","🌙","🔥","🌸","⚔️","🧙","🦉",
  "🐺","🦋","🎩","💎","🕯️","🍷","🌊","⛰️","🃏","🎻","📜","🌹"] as const;

/** One short line: it ends up in a system prompt. */
export const DisplayNameSchema = z.string().transform((s) => s.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(40).regex(/^[^\p{Cc}<>]+$/u, "No control characters or angle brackets"));

export const ProfilePatchSchema = z.object({
  displayName: DisplayNameSchema.optional(),
  avatarEmoji: z.enum(AVATAR_EMOJIS).optional(),
}).refine((v) => v.displayName !== undefined || v.avatarEmoji !== undefined);

export const DeleteAccountSchema = z.object({ confirmEmail: z.string().max(300) });
