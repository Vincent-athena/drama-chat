import OpenAI from "openai";
import type { TaggedMessage } from "./db";
import { characterSystemPrompt, judgePrompt, storyGeneratorPrompt } from "./prompts";
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

/** Streams a character's reply token by token. */
export async function* chatWithCharacter(
  story: Story,
  character: Character,
  phaseIndex: number,
  events: string[],
  history: ChatMessage[],
  userMsg: string
): AsyncGenerator<string> {
  const stream = await deepseek().chat.completions.create({
    model: model(),
    temperature: 1.1,
    stream: true,
    messages: [
      { role: "system", content: characterSystemPrompt(story, character, phaseIndex, events) },
      ...history.slice(-HISTORY_WINDOW),
      { role: "user", content: userMsg },
    ],
  });
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) yield delta;
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
  events: string[]
): Promise<JudgeResult> {
  const raw = await jsonCompletion(
    [{ role: "user", content: judgePrompt(story, phaseIndex, recent, events) }],
    0
  );
  try {
    return JudgeResultSchema.parse(JSON.parse(raw));
  } catch {
    return { completed: false, reason: "judge returned invalid JSON", eventSummary: "" };
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
