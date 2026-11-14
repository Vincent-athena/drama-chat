import { holdersOf } from "./story-checks";
import type { ChatMessage, Character, Story, StoryOutline, TaggedMessage } from "./schema";

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
  /** The player's display name; the character may use it. Character prompts only. */
  playerName?: string;
  /** What the player carries (full descriptions: this prompt stays on the server). */
  carrying?: ItemInfo[];
  /** The item the player is showing in this very message. */
  shownItem?: ItemInfo;
};

export type ItemInfo = { name: string; emoji: string; description: string };

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
Role: ${character.role}${character.appearance && character.appearance.gender !== "other" ? `\nGender: ${character.appearance.gender}` : ""}
Personality: ${character.personality}
Speech style: ${character.speechStyle}

## Other people in this story
${others}

## What you know right now
${knowledge || "- Nothing beyond what anyone would know."}

## What the player is carrying
${context.carrying?.length ? context.carrying.map((i) => `- ${i.emoji} ${i.name}: ${i.description}`).join("\n") : "- Nothing of note."}
If the player claims to show or hand you an important object from this story (evidence, a document, a key, a keepsake) that is not on this list, they do not have it: react with doubt or disbelief. Ordinary things anyone might carry (money, a drink, a phone) are fine.${
    context.shownItem
      ? `
Right now the player is showing you: ${context.shownItem.emoji} ${context.shownItem.name} (${context.shownItem.description}). React to it.`
      : ""
  }

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
- The user is a person inside this world talking to you directly. Address them as such.${
    context.playerName
      ? `
- Who the player is: if the story above casts the player as a named character (for example "you play X" or a title naming the hero), the person talking to you IS that character. Call them by that character's name and treat them as that person, and never use "${context.playerName}". Only when the story gives the player no name of their own, they are called "${context.playerName}"; use that name when it feels natural, as your character would.`
      : ""
  }
- Reply in 1-4 short paragraphs. Put physical actions and expressions in *asterisks*. Every bit of narration (what you do, how you look, how your voice sounds) goes inside asterisks; spoken words go in "quotes" outside them. Example: *She lowers her eyes.* "I can't say it here." *Her voice drops to a whisper.*
- Only speak about things you know. If asked about something outside your knowledge, react as your character would (deflect, guess, lie, or admit ignorance).
- Reply in the same language the user writes in.
- In Vietnamese, the words you use for yourself and for the other person must fit your gender, your age and your relationship to them, and stay the same through the conversation. In a wuxia or historical setting, a younger woman calls herself "muội" and an older man "huynh" (a woman never calls herself "đệ"; "đệ" is for a younger man); an older woman calls herself "tỷ". Follow the same logic in modern settings (em/anh/chị, cháu/chú, con/cha...).${
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
  groupMembers?: GroupMembers,
  owned: Set<string> = new Set()
): string {
  const phase = story.phases[phaseIndex];
  const transcript = recent.map((m) => transcriptLine(story, m, groupMembers)).join("\n");
  const carried = story.items.filter((i) => owned.has(i.id));
  const required = phase.requiredItems
    .map((id) => story.items.find((i) => i.id === id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const findable = story.items.filter(
    (i) => i.source === "found" && !owned.has(i.id) && story.phases.findIndex((p) => p.id === i.availablePhase) <= phaseIndex
  );
  const itemSections = `Items the player carries: ${carried.length ? carried.map((i) => `${i.emoji} ${i.name}`).join(", ") : "(none)"}
${
  required.length
    ? `Required to finish this chapter: ${required.map((i) => `${i.name} (${owned.has(i.id) ? "carried" : "missing"})`).join(", ")}
Judge the criteria as usual; the game itself blocks completion while a required item is missing.
`
    : ""
}${
  findable.length
    ? `Items the player can find now (grant an item only when its condition has actually happened in the conversation: a character mentioning, describing or promising the item is not enough; it must be handed over or taken):
${findable.map((i) => `- id "${i.id}": ${i.name} — condition: ${i.obtainCriteria}`).join("\n")}
`
    : ""
}`;

  return `You are the story director for the interactive drama "${story.title}".
Decide whether the player has completed the current chapter.

Chapter: "${phase.title}"
Player objective: ${phase.objective}
Completion criteria: ${phase.completionCriteria}
${itemSections}
Earlier events:
${events.length ? events.map((e) => `- ${e}`).join("\n") : "- none"}

Your notes from earlier in this chapter (progress already achieved, possibly no longer in the conversation below):
${notes || "(none yet)"}

Recent conversation (oldest first, across all chats):
${transcript || "(no messages yet)"}

Judge strictly but fairly: the criteria must be clearly met, in the conversation or in your notes (e.g. the key information was actually revealed or the key action actually happened), not merely hinted at or asked about. Parts of the criteria may have been met at different times or in different chats; together they count.

Then update your notes: a short bullet list of every part of the criteria that has clearly been achieved so far in this chapter, with who said or did it. Keep everything from your earlier notes unless the conversation contradicts it, and add only what clearly happened. Leave out guesses and things that were only hinted at.

Respond with JSON only, in exactly this shape:
{"completed": true|false, "reason": "one short sentence", "eventSummary": "if completed, one sentence in past tense describing what happened, written as a story event; otherwise empty string", "notes": "- updated bullet list, one item per line", "grantedItemIds": ["item-id", ...]}
"grantedItemIds" lists the ids of the findable items whose condition is clearly met; use an empty array when none.`;
}

/** Port of the reference advance guide, plus the items the player carries and still needs. Server only. */
export function advanceGuidePrompt(
  story: Story,
  phaseIndex: number,
  available: Character[],
  recent: TaggedMessage[],
  events: string[],
  notes: string,
  groupMembers?: GroupMembers,
  owned: Set<string> = new Set()
): string {
  const phase = story.phases[phaseIndex];
  const transcript = recent.map((m) => transcriptLine(story, m, groupMembers)).join("\n");
  const carried = story.items.filter((i) => owned.has(i.id));
  const missing = phase.requiredItems
    .filter((id) => !owned.has(id))
    .map((id) => story.items.find((i) => i.id === id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const howTo = (i: (typeof missing)[number]) =>
    i.source === "ad"
      ? "can be unlocked with an ad"
      : `can be found by talking to the right character (hidden condition, never quote it: ${i.obtainCriteria ?? "none"})`;
  const itemSections = `Items the player carries: ${carried.length ? carried.map((i) => `${i.emoji} ${i.name}`).join(", ") : "(none)"}
${missing.length ? `Still missing (the chapter cannot complete without them):\n${missing.map((i) => `- ${i.emoji} ${i.name}: ${howTo(i)}`).join("\n")}\n` : ""}`;

  return `You are the story director for the interactive drama "${story.title}". The player is stuck and has asked for an advance guide: concrete, personal advice on how to complete the current chapter from where they are now.

Setting: ${story.setting}
Premise: ${story.synopsis}
The player is the protagonist the premise calls "you"; every "Player" line in the conversation is that person speaking.

Chapter: "${phase.title}"
Player objective: ${phase.objective}
Completion criteria (hidden from the player): ${phase.completionCriteria}
Hint already shown to the player: ${phase.hint || "(none)"}
${itemSections}
Characters the player can talk to now:
${available.map((c) => `- ${c.name} (${c.role})`).join("\n")}

Earlier events:
${events.length ? events.map((e) => `- ${e}`).join("\n") : "- none"}

Your notes on progress in this chapter:
${notes || "(none yet)"}

Recent conversation (oldest first, across all chats):
${transcript || "(no messages yet)"}

Explain what is still missing and why the chapter has not completed yet, including anything the player keeps doing that works against the objective. If a required item is missing, say so and how to get it ("can be unlocked with an ad" items are unlocked in the app, not in the story). Then give 2-4 steps, each with the character to talk to, what to do, and one example line the player could send, written in the player's voice and the story's style.
Write each example line in the first person as the protagonist, exactly who the premise says they are; never present the protagonist as someone else's confidant, witness or messenger. Build only on what the story and conversation already contain: do not invent memories, past conversations or instructions the protagonist received.
Guide toward the completion criteria in plain terms, but do not quote them (nor any item condition), do not reveal characters' secrets the player has not uncovered, and say nothing about later chapters or locked characters.
Write in the same language as the story.

Respond with JSON only, in exactly this shape:
{"diagnosis": "2-3 sentences", "steps": [{"character": "name", "action": "what to do", "say": "example line"}]}`;
}

const HAIR_LENGTHS = "Short, Medium, Medium-long, Long";

/** The "appearance" field of a character. Kept as data (for later image generation). */
const APPEARANCE_RULES = `Each character's "appearance" describes how they look and appear in key moments of the story. Write every appearance value in English:
- gender: "female", "male" or "other" (non-human, unknown)
- age: best estimate in years, as a number. Infer it from every clue: a mother of an adult, a director, a veteran, a boss, a god of old or a title like "Bà" means middle-aged or older.
- apparentAge: how old they LOOK, as a number. Same as age unless the story gives a reason (magic, immortality, a spirit in a young body, eternal youth, a dragon in human form). In fantasy or myth settings, consider it for every long-lived character.
- eastAsian: true if they are plausibly East or Southeast Asian
- hairLength: one of ${HAIR_LENGTHS}; hairstyle: 1-4 hairstyle words (e.g. "wavy bangs", "straight", "bob", "updo")
- look: face, build, skin and distinctive features, one sentence
- outfit: their signature clothing, one sentence, true to the setting's era and culture
- scenes: 3 scenes showing this character in the story, each different. Each has "title" (in the story's language, a short caption), "pose" (body pose and camera angle, e.g. "standing, looking back over shoulder", "sitting on stone steps"), "outfit" (what they wear in this scene, true to the era), "background" (place, time of day, lighting) and "mood". Keep every scene suitable for all audiences.`;

const STORY_INTRO = `You are a screenwriter designing an interactive drama chat game. The player talks one-on-one with characters to uncover the story. The story is split into chapters (phases); each chapter has an objective the player must achieve through conversation, and new characters become available as chapters progress.`;

const STORY_REQUIREMENTS = `- Exactly 2 characters unlock in the first phase. Spread the rest across later phases (each later phase should unlock at least one character if possible).
- Each phase objective must be achievable by talking to characters available in that phase.
- completionCriteria must be concrete and checkable from a chat transcript (e.g. "A character has revealed that X did Y").
- Each character needs secrets and knowledgeByPhase entries (keyed by phase id) that create twists and conflict between characters.
- Drama: betrayal, hidden relationships, conflicting motives. Every character wants something.
- ids are short kebab-case strings. avatarEmoji is a single emoji.
- modernSetting: true only if characters wear present-day clothing (roughly 1990 onwards, including near-future cities), false for historical, mythological or fantasy settings.`;

const ITEM_RULES = `Items: the player carries objects that matter to the plot. Write "items" in the story's language, 4 to 6 of them:
- at least one with "source": "start", one "found" and one "ad". Each item has an id (kebab-case), a name, a single emoji, a spoiler-safe "description" the player can read, a "source" and an "availablePhase" (a phase id).
- "start" items are available in the first phase and have no "obtainCriteria". The player owns them from the beginning.
- every "found" item has an "obtainCriteria": a hidden condition that a chat transcript can prove, such as "X has given the player Y" or "X has told the player where Y is and the player took it". Name the giver in the obtainCriteria (by character name); that character must be unlocked by the item's "availablePhase".
- "ad" items are a shortcut or an advantage with a story reason: a character reacts to it, or it is an alternative path written into a phase's completionCriteria with "OR". They have no "obtainCriteria" and are never required.
- at least one phase from the second on has "requiredItems": ids the player must carry before that chapter can end. "requiredItems" only name "start" or "found" items that are available by that phase.
- Write item names and descriptions in the story's language. Descriptions are shown to the player: they must not give away a twist.

Example of the pattern (do not copy): in a poisoning mystery, "gala-invitation" is a start item (available in p1). "glass-shard" ("Shard of the brandy glass") is a found item in p1 with obtainCriteria "Mrs. Hale has handed the player the shard of the broken brandy glass she kept in her apron pocket, or has told the player where she put it and the player has taken it." Phase p2 has "requiredItems": ["glass-shard"]. "orchard-key" is an ad item in p4, never required: p4's completionCriteria reads "... OR the player has shown the orchard cabinet key to Mrs. Hale, she has confirmed that only she and Eleanor hold keys to the cyanide cabinet, and the player has then confronted Eleanor with it."`;

const premiseLine = (premise: string) => `Premise from the user: ${premise || "Surprise me with an original, gripping drama."}`;

/**
 * The story's language comes from the words of the premise, never from where the story is set. Models
 * otherwise drift to the setting's language (an English premise about Brittany came back in French).
 */
const LANGUAGE_RULE = `Language: write the whole story in the language the premise itself is written in, NOT the language of the place or culture where the story is set. An English premise about a French island gives a story written in English; a Vietnamese premise about London gives a story written in Vietnamese. Names of people and places keep their local form. If the premise is empty, write in English.`;

/** Stage 1 of story generation: meta, phases and a roster of character concepts. */
export function storyOutlinePrompt(premise: string, numPhases: number, numCharacters: number): string {
  return `${STORY_INTRO}

${premiseLine(premise)}

${LANGUAGE_RULE}

Design the OUTLINE of a story with exactly ${numPhases} phases and exactly ${numCharacters} characters. Characters get only a short concept now; their full details are written in a later step.
Requirements:
${STORY_REQUIREMENTS}
- "language" names the language the premise is written in. Every other text field (title, synopsis, setting, tone, phases, items, concepts) is written in that language.
- Count carefully: the "phases" array has exactly ${numPhases} entries and the "characters" array has exactly ${numCharacters} entries, no more, no fewer.
- Each character's "concept" is 1-2 sentences: what they want, their main secret or twist, and how they link to other characters.
${ITEM_RULES}

Respond with JSON only, in exactly this shape:
{
  "language": "the language the premise is written in, e.g. English or Tiếng Việt",
  "id": "kebab-case-story-id",
  "title": "string",
  "synopsis": "2-3 sentences shown on the story card",
  "setting": "time, place, atmosphere",
  "tone": "e.g. noir, melodrama, gothic romance",
  "modernSetting": false,
  "phases": [
    {"id": "p1", "title": "string", "narration": "2-4 sentences read when the chapter opens, second person", "objective": "what the player must do, shown to player", "completionCriteria": "hidden, precise condition for the director", "hint": "a gentle nudge", "requiredItems": []}
  ],
  "items": [
    {"id": "kebab-item-id", "name": "string", "emoji": "🗝️", "description": "what the player sees", "source": "start|found|ad", "availablePhase": "p1", "obtainCriteria": "only for found items: the hidden condition"}
  ],
  "characters": [
    {"id": "kebab-id", "name": "string", "role": "string", "avatarEmoji": "🎭", "unlockPhase": "p1", "concept": "1-2 sentences"}
  ]
}`;
}

/** Stage 2 of story generation: full details for a batch of characters from the outline. */
export function characterBatchPrompt(premise: string, outline: StoryOutline, ids: string[]): string {
  const roster = outline.characters
    .map((c) => `- id "${c.id}": ${c.name}, ${c.role}. Unlocks in ${c.unlockPhase}. ${c.concept}`)
    .join("\n");
  const phases = outline.phases
    .map((p) => `- ${p.id} "${p.title}": ${p.objective} (hidden criteria: ${p.completionCriteria})`)
    .join("\n");
  const items = outline.items.length
    ? outline.items
        .map((i) => {
          const holders = holdersOf(i, outline.characters).map((c) => `${c.name} (${c.id})`);
          return (
            `- id "${i.id}": ${i.emoji} ${i.name} (${i.source}, available from ${i.availablePhase})${i.obtainCriteria ? `, obtained when: ${i.obtainCriteria}` : ""}` +
            (holders.length ? `. Held, wanted or recognised by: ${holders.join(", ")}` : "")
          );
        })
        .join("\n")
    : "- none";
  return `${STORY_INTRO}

${premiseLine(premise)}

The story outline is already decided.
Title: ${outline.title}
Synopsis: ${outline.synopsis}
Setting: ${outline.setting}
Tone: ${outline.tone}
modernSetting: ${outline.modernSetting ?? false}

Phases:
${phases}

Items in the story:
${items}

All characters (concepts, so secrets and relationships stay consistent across the cast):
${roster}

Now write the full details of ONLY these characters: ${ids.map((id) => `"${id}"`).join(", ")}.
Requirements:
${STORY_REQUIREMENTS}
- Write in ${outline.language ? `${outline.language}, ` : ""}the language the outline above is written in, wherever the story is set. Only "appearance" is in English.
- Keep each character's id, name, role, avatarEmoji and unlockPhase exactly as in the roster.
- knowledgeByPhase must have an entry for every phase id (${outline.phases.map((p) => p.id).join(", ")}). Be concise: a sentence or two per phase.
- Keep the secrets consistent with the other characters' concepts.
- A character who holds, wants or recognises an item must mention it BY NAME (exactly as listed above) in "knowledgeByPhase" and/or "secrets". For each item above that names holders, that character's "knowledgeByPhase" entry for the item's availablePhase must say when and why they hand it over (found item) or how they react to it (ad item), using the item's exact name.

${APPEARANCE_RULES}

Respond with JSON only, in exactly this shape:
{"characters": [
  {"id": "kebab-id", "name": "string", "role": "string", "avatarEmoji": "🎭", "personality": "string", "speechStyle": "string", "secrets": ["string"], "knowledgeByPhase": {"p1": "what they know or will reveal in p1"}, "unlockPhase": "p1", "appearance": {"gender": "female", "age": 24, "apparentAge": 24, "eastAsian": true, "hairLength": "Long", "hairstyle": "straight", "look": "string", "outfit": "string", "scenes": [{"title": "string", "pose": "string", "outfit": "string", "background": "string", "mood": "string"}]}}
]}`;
}
