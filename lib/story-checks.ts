/** Content rules for the shipped stories: items must be part of the plot, not just valid data. Pure, no I/O. */
import { itemIssues, type Item, type Story } from "./schema";

/** Ad items a story may require: the hard-gate test fixture. Every other required item is `start` or `found`. */
export const AD_REQUIRED_FIXTURES: Record<string, string[]> = { "sample-midnight-manor": ["solicitors-carbon"] };

const norm = (s: string) => s.normalize("NFC").toLowerCase();

/** One string per broken rule; empty when the story's items are well woven into its plot. */
export function storyContentProblems(story: Story): string[] {
  const problems: string[] = [];
  const items = story.items;
  const phaseIndex = new Map(story.phases.map((p, i) => [p.id, i]));
  const at = (phaseId: string) => phaseIndex.get(phaseId) ?? Number.MAX_SAFE_INTEGER;

  if (items.length < 4 || items.length > 7) problems.push(`expected 4 to 7 items, got ${items.length}`);
  for (const source of ["start", "found", "ad"] as const) {
    if (!items.some((i) => i.source === source)) problems.push(`no "${source}" item`);
  }
  if (!story.phases.some((p) => p.requiredItems.length > 0)) problems.push("no phase has requiredItems");
  for (const issue of itemIssues(items, story.phases)) problems.push(`${issue.path.join(".")}: ${issue.message}`);

  const byId = new Map(items.map((i) => [i.id, i]));
  const adFixtures = AD_REQUIRED_FIXTURES[story.id] ?? [];
  story.phases.forEach((phase, pi) => {
    for (const id of phase.requiredItems) {
      const item = byId.get(id);
      if (!item || item.source !== "ad") continue;
      if (pi === 0) problems.push(`phase ${phase.id} (the first) requires the ad item "${id}"`);
      else if (!adFixtures.includes(id)) problems.push(`phase ${phase.id} requires the ad item "${id}"; only fixtures may (${adFixtures.join(", ") || "none"})`);
    }
  });

  const texts = story.characters.map((c) => ({
    unlock: at(c.unlockPhase),
    text: norm([...c.secrets, ...Object.values(c.knowledgeByPhase)].join("\n")),
    knowledge: norm(Object.values(c.knowledgeByPhase).join("\n")),
  }));

  for (const item of items) {
    const name = norm(item.name);
    if (item.source === "found") {
      const firstRequired = story.phases.findIndex((p) => p.requiredItems.includes(item.id));
      const deadline = firstRequired >= 0 ? firstRequired : story.phases.length - 1;
      if (!texts.some((t) => t.unlock <= deadline && t.text.includes(name))) {
        problems.push(`found item "${item.id}" ("${item.name}") is not named in the secrets or knowledge of any character unlocked by ${story.phases[deadline]?.id ?? "the end"}`);
      }
    } else if (item.source === "ad") {
      if (!texts.some((t) => t.knowledge.includes(name))) {
        problems.push(`ad item "${item.id}" ("${item.name}") is not named in any character's knowledgeByPhase`);
      }
    }
  }
  return problems;
}

type Cast = { id: string; name: string; unlockPhase: string; concept?: string };

/** Characters whose name or id appears in the item's obtainCriteria: the people who can hand it over. */
export function giversOf(item: Pick<Item, "obtainCriteria">, characters: Cast[]): Cast[] {
  const criteria = norm(item.obtainCriteria ?? "");
  return criteria ? characters.filter((c) => criteria.includes(norm(c.name)) || criteria.includes(norm(c.id))) : [];
}

/** Characters who hold, want or recognise the item: its givers, plus anyone whose concept mentions its name or id. */
export function holdersOf(item: Pick<Item, "id" | "name" | "obtainCriteria">, characters: Cast[]): Cast[] {
  const givers = giversOf(item, characters);
  const mentions = characters.filter((c) => c.concept && (norm(c.concept).includes(norm(item.name)) || norm(c.concept).includes(item.id)));
  return [...new Set([...givers, ...mentions])];
}
