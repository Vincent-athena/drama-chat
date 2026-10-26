/**
 * Generates a mock story with DeepSeek and saves it to stories/<id>.json.
 *
 *   npm run gen-story -- "a noble family feud in 1920s Shanghai"
 *   npm run gen-story -- "space station mutiny" --phases 5 --characters 8
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { generateStory } from "../lib/deepseek";
import { saveStory } from "../lib/stories";

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const flagValues = new Set(["--phases", "--characters"].map((f) => process.argv[process.argv.indexOf(f) + 1]));
  const premise = process.argv
    .slice(2)
    .filter((a, i, all) => !a.startsWith("--") && !(flagValues.has(a) && all[i - 1]?.startsWith("--")))
    .join(" ");

  console.log(`Generating story${premise ? ` for: "${premise}"` : " (random premise)"} ...`);
  const story = await generateStory(premise, { numPhases: arg("phases", 4), numCharacters: arg("characters", 6) });
  const id = saveStory(story);
  console.log(`\n✔ "${story.title}" saved to stories/${id}.json`);
  story.phases.forEach((p, i) => {
    const cast = story.characters.filter((c) => c.unlockPhase === p.id).map((c) => `${c.avatarEmoji} ${c.name}`);
    console.log(`  Phase ${i + 1}: ${p.title}  →  unlocks ${cast.join(", ") || "(none)"}`);
  });
}

main().catch((err) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
