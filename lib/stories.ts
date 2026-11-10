import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./env";
import type { PublicPhase, PublicStory, StorySummary } from "./api-types";
import { StorySchema, type Character, type Phase, type Story } from "./schema";

export const STORIES_DIR = path.join(process.cwd(), "stories");

/** Generated stories live under DATA_DIR so the bundled set stays read-only. */
export const generatedStoriesDir = () => path.join(dataDir(), "stories");

function readDir(dir: string): Story[] {
  if (!fs.existsSync(dir)) return [];
  const stories: Story[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      stories.push(StorySchema.parse(raw));
    } catch (err) {
      console.warn(`Skipping invalid story file ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return stories;
}

/** Bundled stories first, then generated ones. A bundled id wins over a generated one with the same id. */
export function listStories(): Story[] {
  const bundled = readDir(STORIES_DIR);
  const seen = new Set(bundled.map((s) => s.id));
  return [...bundled, ...readDir(generatedStoriesDir()).filter((s) => !seen.has(s.id))];
}

export function getStory(id: string): Story | null {
  return listStories().find((s) => s.id === id) ?? null;
}

/** Writes the story under a unique id (unique across the bundled and generated sets) and returns the id. */
export function saveStory(story: Story, dir: string = generatedStoriesDir()): string {
  fs.mkdirSync(dir, { recursive: true });
  const taken = (id: string) =>
    fs.existsSync(path.join(dir, `${id}.json`)) || fs.existsSync(path.join(STORIES_DIR, `${id}.json`)) ||
    fs.existsSync(path.join(generatedStoriesDir(), `${id}.json`));
  let id = story.id;
  let n = 2;
  while (taken(id)) id = `${story.id}-${n++}`;
  const final = { ...story, id };
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(final, null, 2) + "\n");
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

/** The secret-free view of a story at `phaseIndex` (taken from the verified save ticket). */
export function toPublicStory(story: Story, phaseIndex: number): PublicStory {
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
  return {
    id: story.id,
    title: story.title,
    synopsis: story.synopsis,
    phaseCount: story.phases.length,
    characterCount: story.characters.length,
  };
}
