import OpenAI from "openai";
import { z } from "zod";
import type { TaggedMessage } from "./db";
import {
  characterSystemPrompt,
  groupChatMessages,
  judgePrompt,
  speakerPrompt,
  storyGeneratorPrompt,
  type CharacterContext,
  type GroupMembers,
} from "./prompts";
import {
  JudgeResultSchema,
  StorySchema,
  type ChatMessage,
  type Character,
  type JudgeResult,
  type Story,
} from "./schema";

export class MissingApiKeyError extends Error {
  constructor() {
    super("DEEPSEEK_API_KEY is not set. Run `npm run setup` to add your DeepSeek API key.");
  }
}

let client: OpenAI | null = null;

function deepseek(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();
  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    });
  }
  return client;
}

const model = () => process.env.DEEPSEEK_MODEL || "deepseek-chat";

const HISTORY_WINDOW = 20;
const GROUP_HISTORY_WINDOW = 30;
const MAX_GROUP_SPEAKERS = 3;

const SpeakersSchema = z.object({ speakers: z.array(z.string()) });

async function* streamReply(messages: OpenAI.Chat.ChatCompletionMessageParam[]): AsyncGenerator<string> {
  const stream = await deepseek().chat.completions.create({
    model: model(),
    temperature: 1.1,
    stream: true,
    messages,
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
  }
}

/** Streams a character's reply token by token. */
export function chatWithCharacter(
  story: Story,
  character: Character,
  phaseIndex: number,
  events: string[],
  history: ChatMessage[],
  userMsg: string,
  context: CharacterContext = {}
): AsyncGenerator<string> {
  return streamReply([
    { role: "system", content: characterSystemPrompt(story, character, phaseIndex, events, context) },
    ...history.slice(-HISTORY_WINDOW),
    { role: "user", content: userMsg },
  ]);
}

/**
 * Streams one character's turn in a group chat. `history` is the group conversation so far,
 * ending with the player's message and any replies already given this round.
 */
export function chatInGroup(
  story: Story,
  character: Character,
  phaseIndex: number,
  events: string[],
  history: TaggedMessage[],
  context: CharacterContext
): AsyncGenerator<string> {
  return streamReply([
    { role: "system", content: characterSystemPrompt(story, character, phaseIndex, events, context) },
    ...groupChatMessages(story, character, history.slice(-GROUP_HISTORY_WINDOW)),
  ]);
}

/** Picks which group members answer the player, in order. Falls back to everyone, capped at 3. */
export async function pickSpeakers(
  story: Story,
  members: Character[],
  history: TaggedMessage[],
  userMsg: string
): Promise<Character[]> {
  const fallback = members.slice(0, MAX_GROUP_SPEAKERS);
  try {
    const raw = await jsonCompletion([{ role: "user", content: speakerPrompt(story, members, history, userMsg) }], 0.3);
    const ids = SpeakersSchema.parse(JSON.parse(raw)).speakers;
    const picked = [...new Set(ids)]
      .map((id) => members.find((c) => c.id === id))
      .filter((c): c is Character => Boolean(c))
      .slice(0, MAX_GROUP_SPEAKERS);
    return picked.length ? picked : fallback;
  } catch {
    return fallback;
  }
}

async function jsonCompletion(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  temperature: number
): Promise<string> {
  const res = await deepseek().chat.completions.create({
    model: model(),
    temperature,
    response_format: { type: "json_object" },
    messages,
  });
  return res.choices[0]?.message?.content ?? "";
}

export async function judgePhase(
  story: Story,
  phaseIndex: number,
  recent: TaggedMessage[],
  events: string[],
  notes: string,
  groupMembers?: GroupMembers
): Promise<JudgeResult> {
  const raw = await jsonCompletion(
    [{ role: "user", content: judgePrompt(story, phaseIndex, recent, events, notes, groupMembers) }],
    0
  );
  try {
    return JudgeResultSchema.parse(JSON.parse(raw));
  } catch {
    return { completed: false, reason: "judge returned invalid JSON", eventSummary: "", notes: "" };
  }
}

export async function generateStory(
  premise: string,
  { numPhases = 4, numCharacters = 6 }: { numPhases?: number; numCharacters?: number } = {}
): Promise<Story> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: storyGeneratorPrompt(premise, numPhases, numCharacters) },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await jsonCompletion(messages, 1.0);
    let problems: string;
    try {
      const parsed = StorySchema.safeParse(JSON.parse(raw));
      if (parsed.success) {
        const story = parsed.data;
        const firstPhaseCount = story.characters.filter((c) => c.unlockPhase === story.phases[0].id).length;
        if (firstPhaseCount === 2 || attempt === 1) return story;
        problems = `Exactly 2 characters must unlock in the first phase, but ${firstPhaseCount} do.`;
      } else {
        problems = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
      }
    } catch {
      problems = "The response was not valid JSON.";
    }
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: `Your JSON has problems:\n${problems}\nReturn the complete corrected JSON only.` }
    );
  }
  throw new Error("DeepSeek did not produce a valid story after 2 attempts. Try again or simplify the premise.");
}
