import { z } from "zod";

// Model output sometimes has null for optional text; treat it as empty.
const text = () => z.string().nullish().transform((v) => v ?? "");

export const PhaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  narration: z.string().min(1),
  objective: z.string().min(1),
  completionCriteria: z.string().min(1),
  hint: z.string().default(""),
  /** Item ids the player must own before the director may close this chapter. */
  requiredItems: z.array(z.string()).default([]),
});

/** Something the player carries. `start` items are owned from the first chapter, `found` ones are granted by the director, `ad` ones come from watching an ad. */
export const ItemSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
  name: z.string().min(1),
  emoji: z.string().default("🎁"),
  description: z.string().min(1), // player-facing, spoiler-safe
  source: z.enum(["start", "found", "ad"]),
  availablePhase: z.string().min(1), // phase id from which it can be obtained (start: the first phase)
  obtainCriteria: text().optional(), // found only; hidden; checkable from a transcript
});

type ItemLike = { id: string; source: "start" | "found" | "ad"; availablePhase: string; obtainCriteria?: string | null };
type PhaseLike = { id: string; requiredItems: string[] };

/**
 * Item rules shared by the story and the generator outline. Each broken rule is its own issue with a path.
 * (A required `ad` item after chapter 1 is allowed by the schema; the generator forbids it.)
 */
export function itemIssues(items: ItemLike[], phases: PhaseLike[]): { message: string; path: (string | number)[] }[] {
  const issues: { message: string; path: (string | number)[] }[] = [];
  const phaseIndex = new Map(phases.map((p, i) => [p.id, i]));
  const byId = new Map<string, ItemLike>();
  items.forEach((item, i) => {
    if (byId.has(item.id)) issues.push({ message: `duplicate item id "${item.id}"`, path: ["items", i, "id"] });
    else byId.set(item.id, item);
    const at = phaseIndex.get(item.availablePhase);
    if (at === undefined) {
      issues.push({ message: `availablePhase "${item.availablePhase}" is not a phase id`, path: ["items", i, "availablePhase"] });
    } else if (item.source === "start" && at !== 0) {
      issues.push({ message: `start item "${item.id}" must be available in the first phase`, path: ["items", i, "availablePhase"] });
    }
    const hasCriteria = Boolean(item.obtainCriteria?.trim());
    if (item.source === "found" && !hasCriteria) {
      issues.push({ message: `found item "${item.id}" needs an obtainCriteria`, path: ["items", i, "obtainCriteria"] });
    }
    if (item.source !== "found" && hasCriteria) {
      issues.push({ message: `${item.source} item "${item.id}" must not have an obtainCriteria`, path: ["items", i, "obtainCriteria"] });
    }
  });
  phases.forEach((phase, pi) => {
    phase.requiredItems.forEach((itemId, ri) => {
      const item = byId.get(itemId);
      const path = ["phases", pi, "requiredItems", ri];
      if (!item) {
        issues.push({ message: `required item "${itemId}" does not exist`, path });
        return;
      }
      const at = phaseIndex.get(item.availablePhase);
      if (at !== undefined && at > pi) {
        issues.push({ message: `required item "${itemId}" is only available from "${item.availablePhase}", after this phase`, path });
      }
      if (pi === 0 && item.source === "ad") {
        issues.push({ message: `the first phase cannot require the ad item "${itemId}"`, path });
      }
    });
  });
  return issues;
}

/** One scene of a character: a pose, an outfit and a background. Kept as data for later image generation. */
export const SceneSchema = z.object({
  title: z.string().min(1),
  pose: text(),
  outfit: text(),
  background: text(),
  mood: text(),
});

/** How a character looks. Descriptions are in English because they may later go into image prompts. */
export const AppearanceSchema = z.object({
  gender: z.enum(["female", "male", "other"]).catch("other"),
  age: z.coerce.number().catch(0),
  /** How old they look. May be lower than `age` when magic, immortality or a body swap keeps them young. */
  apparentAge: z
    .preprocess((v) => (typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number(v) : undefined), z.number().positive().optional())
    .catch(undefined),
  eastAsian: z.boolean().catch(false),
  hairLength: text(),
  hairstyle: text(),
  look: text(),
  outfit: text(),
  scenes: z.array(SceneSchema).default([]),
});

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  avatarEmoji: z.string().default("🎭"),
  personality: z.string().min(1),
  speechStyle: z.string().min(1),
  secrets: z.array(z.string()).default([]),
  knowledgeByPhase: z.record(z.string(), z.string()).default({}),
  unlockPhase: z.string().min(1),
  appearance: AppearanceSchema.optional(),
});

export const StorySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
    title: z.string().min(1),
    synopsis: z.string().min(1),
    setting: z.string().min(1),
    tone: z.string().min(1),
    /** Present-day clothing (roughly 1990 onwards) rather than historical, mythological or fantasy dress. */
    modernSetting: z.boolean().optional(),
    characters: z.array(CharacterSchema).min(2),
    phases: z.array(PhaseSchema).min(2),
    items: z.array(ItemSchema).default([]),
  })
  .superRefine((story, ctx) => {
    const phaseIds = new Set(story.phases.map((p) => p.id));
    if (phaseIds.size !== story.phases.length) {
      ctx.addIssue({ code: "custom", message: "phase ids must be unique", path: ["phases"] });
    }
    const charIds = new Set(story.characters.map((c) => c.id));
    if (charIds.size !== story.characters.length) {
      ctx.addIssue({ code: "custom", message: "character ids must be unique", path: ["characters"] });
    }
    story.characters.forEach((c, i) => {
      if (!phaseIds.has(c.unlockPhase)) {
        ctx.addIssue({
          code: "custom",
          message: `unlockPhase "${c.unlockPhase}" is not a phase id`,
          path: ["characters", i, "unlockPhase"],
        });
      }
    });
    const firstPhase = story.phases[0]?.id;
    if (!story.characters.some((c) => c.unlockPhase === firstPhase)) {
      ctx.addIssue({
        code: "custom",
        message: "at least one character must unlock in the first phase",
        path: ["characters"],
      });
    }
    for (const issue of itemIssues(story.items, story.phases)) ctx.addIssue({ code: "custom", ...issue });
  });

/** Stage 1 of story generation: meta, phases and a roster of short character concepts. */
export const StoryOutlineSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
  title: z.string().min(1),
  synopsis: z.string().min(1),
  setting: z.string().min(1),
  tone: z.string().min(1),
  modernSetting: z.boolean().optional(),
  phases: z.array(PhaseSchema).min(2),
  items: z.array(ItemSchema).default([]),
  characters: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      role: z.string().min(1),
      avatarEmoji: z.string().default("🎭"),
      unlockPhase: z.string().min(1),
      concept: z.string().min(1),
    })
  ),
});

export type Phase = z.infer<typeof PhaseSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type Appearance = z.infer<typeof AppearanceSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Story = z.infer<typeof StorySchema>;
export type StoryOutline = z.infer<typeof StoryOutlineSchema>;

export const JudgeResultSchema = z.object({
  completed: z.boolean(),
  reason: z.string().default(""),
  eventSummary: z.string().default(""),
  notes: z.string().default(""),
  /** Ids of found items the director says the player obtained in this conversation. */
  grantedItemIds: z.array(z.string()).default([]),
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

/** The advance guide: what is missing and 2-4 concrete steps. Written from hidden criteria, so it is model output only. */
export const AdvanceGuideSchema = z.object({
  diagnosis: z.string().default(""),
  steps: z
    .array(z.object({ character: z.string().default(""), action: z.string().default(""), say: z.string().default("") }))
    .default([]),
});
export type AdvanceGuide = z.infer<typeof AdvanceGuideSchema>;

// Shapes sent to the browser: no secrets, no judge criteria, no future knowledge.
export type PublicCharacter = {
  id: string;
  name: string;
  role: string;
  avatarEmoji: string;
  personality: string;
  unlocked: boolean;
  unlockPhaseTitle: string;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * A message with its context. In a one-on-one chat, characterId is the character talked to;
 * in a group (groupId set), it is the speaker, or "" when the player spoke.
 */
export type TaggedMessage = ChatMessage & { characterId: string; groupId: number | null };

/** A group chat, kept in the player's browser. */
export type Group = { id: number; storyId: string; memberIds: string[] };
