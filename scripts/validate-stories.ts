/** Checks every file in stories/ against StorySchema and the content rules. Exit code 1 on any problem. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StorySchema } from "../lib/schema";
import { storyContentProblems } from "../lib/story-checks";

const dir = join(__dirname, "..", "stories");
let failed = false;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
  let problems: string[];
  try {
    const parsed = StorySchema.safeParse(JSON.parse(readFileSync(join(dir, file), "utf8")));
    problems = parsed.success
      ? storyContentProblems(parsed.data)
      : parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  } catch (e) {
    problems = [e instanceof Error ? e.message : String(e)];
  }
  if (problems.length) {
    failed = true;
    console.log(`✖ ${file}`);
    for (const p of problems) console.log(`    ${p}`);
  } else console.log(`✔ ${file}`);
}
process.exit(failed ? 1 : 0);
