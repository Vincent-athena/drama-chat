import OpenAI from "openai";
import { z } from "zod";
import {
  advanceGuidePrompt,
  characterBatchPrompt,
  characterSystemPrompt,
  groupChatMessages,
  judgePrompt,
  speakerPrompt,
  storyOutlinePrompt,
  type CharacterContext,
  type GroupMembers,
} from "./prompts";
import {
  AdvanceGuideSchema,
  CharacterSchema,
  JudgeResultSchema,
  StoryOutlineSchema,
  StorySchema,
  itemIssues,
  type AdvanceGuide,
  type ChatMessage,
  type Character,
  type JudgeResult,
  type Story,
  type StoryOutline,
  type TaggedMessage,
} from "./schema";

export class MissingApiKeyError extends Error {
  constructor() {
    super("DEEPSEEK_API_KEY is not set. Run `npm run setup` to add your DeepSeek API key.");
  }
}

/** True when at least one model provider is configured. Routes call this instead of reading env. */
export function hasApiKey(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

/** Which kind of request a model call is. Ignored until providers are split per task. */
type LlmTask = "chat" | "speakers" | "judge" | "guide" | "story";

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

async function* streamReply(
  _task: LlmTask,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  temperature = 1.1
): AsyncGenerator<string> {
  const stream = await deepseek().chat.completions.create({
    model: model(),
    temperature,
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
  return streamReply("chat", [
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
  return streamReply("chat", [
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
    const raw = await jsonCompletion("speakers", [{ role: "user", content: speakerPrompt(story, members, history, userMsg) }], 0.3);
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


/** The model's JSON reply; with `maxTokens` set, `truncated` says the reply hit that limit and was cut off. */
async function jsonCompletionChecked(
  _task: LlmTask,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  temperature: number,
  maxTokens?: number
): Promise<{ raw: string; truncated: boolean }> {
  const res = await deepseek().chat.completions.create({
    model: model(),
    temperature,
    response_format: { type: "json_object" },
    messages,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  });
  const choice = res.choices[0];
  return { raw: choice?.message?.content ?? "", truncated: choice?.finish_reason === "length" };
}

async function jsonCompletion(
  task: LlmTask,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  temperature: number,
  maxTokens?: number
): Promise<string> {
  return (await jsonCompletionChecked(task, messages, temperature, maxTokens)).raw;
}

export async function judgePhase(
  story: Story,
  phaseIndex: number,
  recent: TaggedMessage[],
  events: string[],
  notes: string,
  groupMembers?: GroupMembers,
  owned: Set<string> = new Set()
): Promise<JudgeResult> {
  const raw = await jsonCompletion(
    "judge",
    [{ role: "user", content: judgePrompt(story, phaseIndex, recent, events, notes, groupMembers, owned) }],
    0
  );
  try {
    return JudgeResultSchema.parse(JSON.parse(raw));
  } catch {
    return { completed: false, reason: "judge returned invalid JSON", eventSummary: "", notes: "", grantedItemIds: [] };
  }
}


export async function generateAdvanceGuide(
  story: Story,
  phaseIndex: number,
  available: Character[],
  recent: TaggedMessage[],
  events: string[],
  notes: string,
  groupMembers?: GroupMembers,
  owned: Set<string> = new Set()
): Promise<AdvanceGuide> {
  const raw = await jsonCompletion(
    "guide",
    [{ role: "user", content: advanceGuidePrompt(story, phaseIndex, available, recent, events, notes, groupMembers, owned) }],
    0.4
  );
  return AdvanceGuideSchema.parse(JSON.parse(raw));
}

/**
 * Swaps closing brackets that don't match what they close, e.g. an object ended with "]".
 * Long generated stories occasionally contain this slip, which otherwise fails the whole story.
 */
export function fixMismatchedBrackets(raw: string): string {
  const out = raw.split("");
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < out.length; i++) {
    const ch = out[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      const expected = stack.pop();
      if (expected && ch !== expected) out[i] = expected;
    }
  }
  return out.join("");
}

/** Describes a JSON syntax error with the lines around it, so the model can find it. */
function describeJsonError(raw: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const line = Number(/line (\d+)/.exec(message)?.[1]);
  if (!line) return `The response was not valid JSON: ${message}`;
  const lines = raw.split("\n");
  const context = lines.slice(Math.max(0, line - 4), line + 2).join("\n");
  return `The response was not valid JSON: ${message}\nAround line ${line}:\n${context}`;
}

const STORY_ATTEMPTS = 3;
const STORY_MAX_TOKENS = 8192;
const CHARACTERS_PER_BATCH = 3;

const TRUNCATED_PROBLEM = "The response was cut off before the JSON ended. Be more concise.";

type Checked<T> = { value: T; problems?: undefined } | { problems: string };

/**
 * Asks for JSON until `check` accepts it, feeding the problems back to the model.
 * `check` returns the value, or a description of what is wrong.
 */
async function generateChecked<T>(
  stage: string,
  prompt: string,
  check: (json: unknown) => Checked<T>
): Promise<T> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "user", content: prompt }];
  let problems = "";
  for (let attempt = 0; attempt < STORY_ATTEMPTS; attempt++) {
    const { raw, truncated } = await jsonCompletionChecked("story", messages, 1.0, STORY_MAX_TOKENS);
    let json: unknown;
    if (truncated) {
      problems = TRUNCATED_PROBLEM;
    } else {
      try {
        json = JSON.parse(fixMismatchedBrackets(raw));
      } catch (err) {
        problems = describeJsonError(raw, err);
      }
    }
    if (json !== undefined) {
      const result = check(json);
      if (result.problems === undefined) return result.value;
      problems = result.problems;
    }
    messages.push(
      { role: "assistant", content: raw },
      { role: "user", content: `Your JSON has problems:\n${problems}\nReturn the complete corrected JSON only.` }
    );
  }
  throw new Error(
    `Story generation failed at the ${stage} stage after ${STORY_ATTEMPTS} attempts (last problem: ${problems.split("\n")[0]}). ` +
      "Try again, or use fewer chapters or characters."
  );
}

const zodProblems = (error: z.ZodError) =>
  error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");

/** Item rules of the outline: the schema rules plus what the generator additionally demands. */
function itemProblems(outline: StoryOutline): string[] {
  const problems: string[] = [];
  const items = outline.items;
  const phaseIds = outline.phases.map((p) => p.id);
  if (items.length < 4 || items.length > 6) problems.push(`Expected 4 to 6 items, got ${items.length}.`);
  for (const source of ["start", "found", "ad"] as const) {
    if (!items.some((i) => i.source === source)) problems.push(`There must be at least one "${source}" item.`);
  }
  for (const issue of itemIssues(items, outline.phases)) problems.push(`${issue.path.join(".")}: ${issue.message}.`);
  const ads = new Set(items.filter((i) => i.source === "ad").map((i) => i.id));
  outline.phases.forEach((p, pi) => {
    for (const id of p.requiredItems) {
      if (ads.has(id)) problems.push(`phases.${pi}.requiredItems: "${id}" is an ad item; ad items must never be required.`);
    }
  });
  if (!outline.phases.slice(1).some((p) => p.requiredItems.length > 0)) {
    problems.push("At least one phase from the second on must have requiredItems.");
  }
  for (const item of items) {
    if (item.source !== "found") continue;
    const at = phaseIds.indexOf(item.availablePhase);
    if (at < 0) continue;
    if (!outline.characters.some((c) => phaseIds.indexOf(c.unlockPhase) <= at)) {
      problems.push(`Found item "${item.id}" is available from "${item.availablePhase}", but no character is unlocked by then to hand it over.`);
    }
  }
  return problems;
}

/** Problems with the outline's counts, ids and unlock phases, or "" when it is fine. */
export function outlineProblems(outline: StoryOutline, numPhases: number, numCharacters: number): string {
  const problems: string[] = [];
  const phaseIds = outline.phases.map((p) => p.id);
  if (outline.phases.length !== numPhases) problems.push(`Expected exactly ${numPhases} phases, got ${outline.phases.length}.`);
  if (outline.characters.length !== numCharacters) {
    problems.push(
      `Expected exactly ${numCharacters} characters, got ${outline.characters.length}: ` +
        `${outline.characters.length > numCharacters ? "remove" : "add"} ${Math.abs(outline.characters.length - numCharacters)}.`
    );
  }
  if (new Set(phaseIds).size !== phaseIds.length) problems.push("Phase ids must be unique.");
  const charIds = outline.characters.map((c) => c.id);
  if (new Set(charIds).size !== charIds.length) problems.push("Character ids must be unique.");
  for (const c of outline.characters) {
    if (!phaseIds.includes(c.unlockPhase)) {
      problems.push(`Character "${c.id}" has unlockPhase "${c.unlockPhase}", which is not a phase id (${phaseIds.join(", ")}).`);
    }
  }
  const first = outline.characters.filter((c) => c.unlockPhase === phaseIds[0]).length;
  if (first !== 2) problems.push(`Exactly 2 characters must unlock in the first phase, but ${first} do.`);
  if (numCharacters >= numPhases + 1) {
    const empty = phaseIds.slice(1).filter((id) => !outline.characters.some((c) => c.unlockPhase === id));
    if (empty.length) problems.push(`Each later phase should unlock at least one character; none unlock in: ${empty.join(", ")}.`);
  }
  problems.push(...itemProblems(outline));
  return problems.join("\n");
}

/**
 * The model often writes a character or two too many. Drops the extras from the most crowded later phase,
 * latest first, rather than failing the whole outline.
 */
export function dropExtraCharacters(outline: StoryOutline, numCharacters: number): StoryOutline {
  const characters = [...outline.characters];
  const firstPhase = outline.phases[0]?.id;
  while (characters.length > numCharacters) {
    const counts = new Map<string, number>();
    for (const c of characters) counts.set(c.unlockPhase, (counts.get(c.unlockPhase) ?? 0) + 1);
    let drop = -1;
    for (let i = characters.length - 1; i >= 0; i--) {
      const phase = characters[i].unlockPhase;
      if (phase === firstPhase) continue;
      if (drop === -1 || counts.get(phase)! > counts.get(characters[drop].unlockPhase)!) drop = i;
    }
    if (drop === -1) break;
    characters.splice(drop, 1);
  }
  return { ...outline, characters };
}

const CharacterBatchSchema = z.object({ characters: z.array(z.unknown()) });

/** Writes the full details of the characters `ids`, keeping the roster's id, name, role, emoji and unlock phase. */
async function generateCharacterBatch(
  premise: string,
  outline: StoryOutline,
  ids: string[]
): Promise<Character[]> {
  const roster = new Map(outline.characters.map((c) => [c.id, c]));
  return generateChecked(`character details (${ids.join(", ")})`, characterBatchPrompt(premise, outline, ids), (json): Checked<Character[]> => {
    const batch = CharacterBatchSchema.safeParse(json);
    if (!batch.success) return { problems: 'Expected {"characters": [...]}.' };
    const byId = new Map<string, unknown>();
    for (const c of batch.data.characters) {
      const id = (c as { id?: unknown } | null)?.id;
      if (typeof id === "string") byId.set(id, c);
    }
    const problems: string[] = [];
    const characters: Character[] = [];
    for (const id of ids) {
      const given = byId.get(id);
      if (!given) {
        problems.push(`Missing the character with id "${id}".`);
        continue;
      }
      const { name, role, avatarEmoji, unlockPhase } = roster.get(id)!;
      const parsed = CharacterSchema.safeParse({ ...(given as object), id, name, role, avatarEmoji, unlockPhase });
      if (parsed.success) characters.push(parsed.data);
      else problems.push(`Character "${id}":\n${zodProblems(parsed.error)}`);
    }
    return problems.length ? { problems: problems.join("\n") } : { value: characters };
  });
}

/**
 * Generates a story in stages, since the whole thing does not fit in one reply:
 * an outline (meta, phases, character roster), then full character details in parallel batches.
 */
export async function generateStory(
  premise: string,
  { numPhases = 4, numCharacters = 6 }: { numPhases?: number; numCharacters?: number } = {}
): Promise<Story> {
  const outline = await generateChecked("outline", storyOutlinePrompt(premise, numPhases, numCharacters), (json): Checked<StoryOutline> => {
    const parsed = StoryOutlineSchema.safeParse(json);
    if (!parsed.success) return { problems: zodProblems(parsed.error) };
    const trimmed = dropExtraCharacters(parsed.data, numCharacters);
    const problems = outlineProblems(trimmed, numPhases, numCharacters);
    return problems ? { problems } : { value: trimmed };
  });

  const ids = outline.characters.map((c) => c.id);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += CHARACTERS_PER_BATCH) batches.push(ids.slice(i, i + CHARACTERS_PER_BATCH));
  const details = (await Promise.all(batches.map((batch) => generateCharacterBatch(premise, outline, batch)))).flat();
  const byId = new Map(details.map((c) => [c.id, c]));

  const { characters: _roster, ...meta } = outline;
  const parsed = StorySchema.safeParse({ ...meta, characters: ids.map((id) => byId.get(id)) });
  if (!parsed.success) {
    throw new Error(`Story generation failed at the assembly stage: ${zodProblems(parsed.error).split("\n")[0]}`);
  }
  return parsed.data;
}
