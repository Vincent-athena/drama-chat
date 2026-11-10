/** Context caps. Isomorphic (the browser fits its context under them); re-exported by lib/limits.ts. */
export const CONTEXT_LIMITS = {
  bodyBytes: 256_000, // readJsonBody rejects larger with 413 too_large
  messageChars: 2_000, // the new player message
  contentChars: 6_000, // any message inside context
  history: 20,
  groupHistory: 30,
  groupChats: 20,
  recent: 30,
  privateChat: 20,
  groupMembers: 6,
  groups: 30,
  events: 20,
  eventChars: 600,
  notesChars: 4_000,
} as const;
