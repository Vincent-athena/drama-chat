import { z } from "zod";

export const PhaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  narration: z.string().min(1),
  objective: z.string().min(1),
  completionCriteria: z.string().min(1),
  hint: z.string().default(""),
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
});

export const StorySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, "id must be kebab-case"),
    title: z.string().min(1),
    synopsis: z.string().min(1),
    setting: z.string().min(1),
    tone: z.string().min(1),
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

export type Phase = z.infer<typeof PhaseSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type Story = z.infer<typeof StorySchema>;

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

export type PublicPhase = {
  id: string;
  title: string;
  narration: string;
  objective: string;
  hint: string;
};

export type PublicStory = {
  id: string;
  title: string;
  synopsis: string;
  setting: string;
  tone: string;
  phaseIndex: number;
  phaseCount: number;
  finished: boolean;
  currentPhase: PublicPhase | null;
  pastPhases: PublicPhase[];
  characters: PublicCharacter[];
};

export type StorySummary = {
  id: string;
  title: string;
  synopsis: string;
  phaseIndex: number;
  phaseCount: number;
  finished: boolean;
  characterCount: number;
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type PublicGroup = { id: number; memberIds: string[] };

/** A group chat message; characterId is the speaker, or "" when the player spoke. */
export type GroupChatMessage = ChatMessage & { characterId: string };
