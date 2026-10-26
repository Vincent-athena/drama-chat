import type { ChatMessage, Character, Story } from "./schema";
import type { TaggedMessage } from "./db";

/** Member ids of each group chat, keyed by group id. */
export type GroupMembers = Map<number, string[]>;

/** What a character remembers from its other conversations. */
export type CharacterContext = {
  /** Set when the character is speaking in a group chat: everyone else present. */
  groupWith?: Character[];
  /** The character's own one-on-one chat with the player (used in group chats). */
  privateChat?: ChatMessage[];
  /** Recent messages from group chats the character took part in (used in one-on-one chats). */
  groupChats?: TaggedMessage[];
  groupMembers?: GroupMembers;
};

function nameOf(story: Story, id: string): string {
  return story.characters.find((c) => c.id === id)?.name ?? id;
}

/** "group chat with A, B, C" label for a group. */
function groupLabel(story: Story, memberIds: string[] | undefined): string {
  return memberIds?.length ? `group chat with ${memberIds.map((id) => nameOf(story, id)).join(", ")}` : "group chat";
}

/** One line per message: "[Speaker | where] text". */
function transcriptLine(story: Story, m: TaggedMessage, groupMembers?: GroupMembers): string {
  if (m.groupId == null) {
    const name = nameOf(story, m.characterId);
    return `[${m.role === "user" ? "Player" : name} | chat with ${name}] ${m.content}`;
  }
  const speaker = m.role === "user" ? "Player" : nameOf(story, m.characterId);
  return `[${speaker} | ${groupLabel(story, groupMembers?.get(m.groupId))}] ${m.content}`;
}

export function characterSystemPrompt(
  story: Story,
  character: Character,
  phaseIndex: number,
  events: string[],
  context: CharacterContext = {}
): string {
  const finished = phaseIndex >= story.phases.length;
  const reached = story.phases.slice(0, Math.min(phaseIndex + 1, story.phases.length));
  const knowledge = reached
    .map((p) => character.knowledgeByPhase[p.id])
    .filter(Boolean)
    .map((k) => `- ${k}`)
    .join("\n");
  const current = finished ? null : story.phases[phaseIndex];
  const others = story.characters
    .filter((c) => c.id !== character.id)
    .map((c) => `- ${c.name} (${c.role})`)
    .join("\n");
  const inGroup = Boolean(context.groupWith?.length);
  const privateChat = context.privateChat?.length
    ? context.privateChat.map((m) => `${m.role === "user" ? "Player" : "You"}: ${m.content}`).join("\n")
    : "";
  const groupChats = context.groupChats?.length
    ? context.groupChats.map((m) => transcriptLine(story, m, context.groupMembers)).join("\n")
    : "";

  return `You are ${character.name}, a character in an interactive drama called "${story.title}".

## The world
Setting: ${story.setting}
Tone: ${story.tone}
Premise: ${story.synopsis}

## Who you are
Role: ${character.role}
Personality: ${character.personality}
Speech style: ${character.speechStyle}

## Other people in this story
${others}

## What you know right now
${knowledge || "- Nothing beyond what anyone would know."}

## Your secrets
${character.secrets.map((s) => `- ${s}`).join("\n") || "- None."}
Guard these. Reveal a secret only when the other person earns it: by pressing you with evidence, catching you in a lie, or earning real trust. When you do reveal one, make it a dramatic moment.

## What has happened so far
${events.length ? events.map((e) => `- ${e}`).join("\n") : "- The story is just beginning."}

${
  inGroup
    ? `## Where you are now
You are in a group conversation with the player and ${context.groupWith!.map((c) => `${c.name} (${c.role})`).join(", ")}. Everyone present hears everything you say, so think about what you reveal in front of them.
${privateChat ? `\n## Your private conversations with the player (the others here did not hear these)\n${privateChat}\n` : ""}`
    : groupChats
      ? `## Group conversations you were part of (recent; everyone in each group heard them)\n${groupChats}\n`
      : ""
}
## Current chapter (background for you; never say it aloud)
${
  current
    ? `Chapter "${current.title}". The person talking to you is trying to: ${current.objective}. React naturally: don't hand it to them, but don't make it impossible if they are clever or persistent.`
    : "The story has reached its end. You may reflect on what happened."
}

## Rules
- Stay fully in character at all times. Never mention being an AI, a model, a prompt, or a game.
- The user is a person inside this world talking to you directly. Address them as such.
- Reply in 1-4 short paragraphs. Put physical actions and expressions in *asterisks*.
- Only speak about things you know. If asked about something outside your knowledge, react as your character would (deflect, guess, lie, or admit ignorance).
- Reply in the same language the user writes in.${
    inGroup
      ? `
- In the group, other people's lines reach you as "[Name]: text". Speak only as yourself: never write lines for anyone else and don't put your name in front of your reply.
- Keep it to 1-2 short paragraphs, and react to what the others just said as well as to the player.`
      : ""
  }`;
}

/**
 * The messages a character sees in a group chat: its own lines as "assistant",
 * everyone else's merged into "user" turns, each line tagged with the speaker.
 */
export function groupChatMessages(story: Story, self: Character, history: TaggedMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === "assistant" && m.characterId === self.id) {
      out.push({ role: "assistant", content: m.content });
      continue;
    }
    const line = `[${m.role === "user" ? "Player" : nameOf(story, m.characterId)}]: ${m.content}`;
    const last = out[out.length - 1];
    if (last?.role === "user") last.content += `\n\n${line}`;
    else out.push({ role: "user", content: line });
  }
  return out;
}

export function speakerPrompt(story: Story, members: Character[], history: TaggedMessage[], userMsg: string): string {
  const recent = history
    .slice(-12)
    .map((m) => `[${m.role === "user" ? "Player" : nameOf(story, m.characterId)}] ${m.content}`)
    .join("\n");
  return `You direct a group scene in the interactive drama "${story.title}". The player just spoke to a group.
Decide which characters reply, and in what order.

Characters present:
${members.map((c) => `- id "${c.id}": ${c.name}, ${c.role}. ${c.personality}`).join("\n")}

Recent conversation (oldest first):
${recent || "(none yet)"}

The player now says: ${userMsg}

Rules:
- Pick 1 to 3 characters. Anyone the player addresses by name or role replies first.
- Add others only if they would naturally react: they are accused, mentioned, provoked, or have a strong stake.
- If the player speaks to everyone, let the most affected characters answer.

Respond with JSON only: {"speakers": ["id", ...]}`;
}

export function judgePrompt(
  story: Story,
  phaseIndex: number,
  recent: TaggedMessage[],
  events: string[],
  notes: string,
  groupMembers?: GroupMembers
): string {
  const phase = story.phases[phaseIndex];
  const transcript = recent.map((m) => transcriptLine(story, m, groupMembers)).join("\n");

  return `You are the story director for the interactive drama "${story.title}".
Decide whether the player has completed the current chapter.

Chapter: "${phase.title}"
Player objective: ${phase.objective}
Completion criteria: ${phase.completionCriteria}

Earlier events:
${events.length ? events.map((e) => `- ${e}`).join("\n") : "- none"}

Your notes from earlier in this chapter (progress already achieved, possibly no longer in the conversation below):
${notes || "(none yet)"}

Recent conversation (oldest first, across all chats):
${transcript || "(no messages yet)"}

Judge strictly but fairly: the criteria must be clearly met, in the conversation or in your notes (e.g. the key information was actually revealed or the key action actually happened), not merely hinted at or asked about. Parts of the criteria may have been met at different times or in different chats; together they count.

Then update your notes: a short bullet list of every part of the criteria that has clearly been achieved so far in this chapter, with who said or did it. Keep everything from your earlier notes unless the conversation contradicts it, and add only what clearly happened. Leave out guesses and things that were only hinted at.

Respond with JSON only, in exactly this shape:
{"completed": true|false, "reason": "one short sentence", "eventSummary": "if completed, one sentence in past tense describing what happened, written as a story event; otherwise empty string", "notes": "- updated bullet list, one item per line"}`;
}

export function storyGeneratorPrompt(premise: string, numPhases: number, numCharacters: number): string {
  return `You are a screenwriter designing an interactive drama chat game. The player talks one-on-one with characters to uncover the story. The story is split into chapters (phases); each chapter has an objective the player must achieve through conversation, and new characters become available as chapters progress.

Premise from the user: ${premise || "Surprise me with an original, gripping drama."}

Design a story with exactly ${numPhases} phases and exactly ${numCharacters} characters.
Requirements:
- Exactly 2 characters unlock in the first phase. Spread the rest across later phases (each later phase should unlock at least one character if possible).
- Each phase objective must be achievable by talking to characters available in that phase.
- completionCriteria must be concrete and checkable from a chat transcript (e.g. "A character has revealed that X did Y").
- Each character needs secrets and knowledgeByPhase entries (keyed by phase id) that create twists and conflict between characters.
- Drama: betrayal, hidden relationships, conflicting motives. Every character wants something.
- ids are short kebab-case strings. avatarEmoji is a single emoji.
- Write in the same language as the premise.

Respond with JSON only, in exactly this shape:
{
  "id": "kebab-case-story-id",
  "title": "string",
  "synopsis": "2-3 sentences shown on the story card",
  "setting": "time, place, atmosphere",
  "tone": "e.g. noir, melodrama, gothic romance",
  "phases": [
    {"id": "p1", "title": "string", "narration": "2-4 sentences read when the chapter opens, second person", "objective": "what the player must do, shown to player", "completionCriteria": "hidden, precise condition for the director", "hint": "a gentle nudge"}
  ],
  "characters": [
    {"id": "kebab-id", "name": "string", "role": "string", "avatarEmoji": "🎭", "personality": "string", "speechStyle": "string", "secrets": ["string"], "knowledgeByPhase": {"p1": "what they know or will reveal in p1"}, "unlockPhase": "p1"}
  ]
}`;
}
