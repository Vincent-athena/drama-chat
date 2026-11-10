import { z } from "zod";

export const PhaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  narration: z.string().min(1),
  objective: z.string().min(1),
  completionCriteria: z.string().min(1),
  hint: z.string().default(""),
});

// Model output sometimes has null for optional text; treat it as empty.
const text = () => z.string().nullish().transform((v) => v ?? "");

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
});
export type JudgeResult = z.infer<typeof JudgeResultSchema>;

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
