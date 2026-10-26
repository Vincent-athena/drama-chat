import fs from "node:fs";
import path from "node:path";
import { getPhaseIndex } from "./db";
import {
  StorySchema,
  type Character,
  type Phase,
  type PublicPhase,
  type PublicStory,
  type Story,
  type StorySummary,
} from "./schema";

export const STORIES_DIR = path.join(process.cwd(), "stories");

export function listStories(): Story[] {
  if (!fs.existsSync(STORIES_DIR)) return [];
  const stories: Story[] = [];
  for (const file of fs.readdirSync(STORIES_DIR).sort()) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(STORIES_DIR, file), "utf8"));
      stories.push(StorySchema.parse(raw));
    } catch (err) {
      console.warn(`Skipping invalid story file ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return stories;
}

export function getStory(id: string): Story | null {
  return listStories().find((s) => s.id === id) ?? null;
}

export function saveStory(story: Story): string {
  fs.mkdirSync(STORIES_DIR, { recursive: true });
  let id = story.id;
  let n = 2;
  while (fs.existsSync(path.join(STORIES_DIR, `${id}.json`))) id = `${story.id}-${n++}`;
  const final = { ...story, id };
  fs.writeFileSync(path.join(STORIES_DIR, `${id}.json`), JSON.stringify(final, null, 2) + "\n");
  return id;
}

export function phaseIndexOf(story: Story, phaseId: string): number {
  return story.phases.findIndex((p) => p.id === phaseId);
}

export function isUnlocked(story: Story, character: Character, phaseIndex: number): boolean {
  return phaseIndex >= phaseIndexOf(story, character.unlockPhase);
}

/** Characters that become available exactly when the story enters `phaseIndex`. */
export function charactersUnlockedAt(story: Story, phaseIndex: number): Character[] {
  return story.characters.filter((c) => phaseIndexOf(story, c.unlockPhase) === phaseIndex);
}

function publicPhase(p: Phase): PublicPhase {
  return { id: p.id, title: p.title, narration: p.narration, objective: p.objective, hint: p.hint };
}

export function toPublicStory(story: Story): PublicStory {
  const phaseIndex = getPhaseIndex(story.id);
  const finished = phaseIndex >= story.phases.length;
  return {
    id: story.id,
    title: story.title,
    synopsis: story.synopsis,
    setting: story.setting,
    tone: story.tone,
    phaseIndex,
    phaseCount: story.phases.length,
    finished,
    currentPhase: finished ? null : publicPhase(story.phases[phaseIndex]),
    pastPhases: story.phases.slice(0, Math.min(phaseIndex, story.phases.length)).map(publicPhase),
    characters: story.characters.map((c) => {
      const unlocked = isUnlocked(story, c, phaseIndex);
      return {
        id: c.id,
        name: unlocked ? c.name : "???",
        role: unlocked ? c.role : "Unknown",
        avatarEmoji: unlocked ? c.avatarEmoji : "👤",
        personality: unlocked ? c.personality : "",
        unlocked,
        unlockPhaseTitle: story.phases[phaseIndexOf(story, c.unlockPhase)]?.title ?? "",
      };
    }),
  };
}

export function toStorySummary(story: Story): StorySummary {
  const phaseIndex = getPhaseIndex(story.id);
  return {
    id: story.id,
    title: story.title,
    synopsis: story.synopsis,
    phaseIndex,
    phaseCount: story.phases.length,
    finished: phaseIndex >= story.phases.length,
    characterCount: story.characters.length,
  };
}
