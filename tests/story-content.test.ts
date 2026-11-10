import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { StorySchema, type Story } from "../lib/schema";
import { AD_REQUIRED_FIXTURES, giversOf, holdersOf, storyContentProblems } from "../lib/story-checks";

const dir = join(__dirname, "..", "stories");
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

describe("shipped stories", () => {
  for (const file of files) {
    it(`${file} parses and satisfies the content rules`, () => {
      const parsed = StorySchema.safeParse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
      assert.deepEqual(storyContentProblems(parsed.data), []);
    });
  }
  it("only the Midnight Manor fixture requires an ad item", () => {
    assert.deepEqual(AD_REQUIRED_FIXTURES, { "sample-midnight-manor": ["solicitors-carbon"] });
  });
});

const manor = (): Story => StorySchema.parse(JSON.parse(readFileSync(join(dir, "sample-midnight-manor.json"), "utf8")));
const problems = (edit: (s: Story) => void, base: () => Story = manor) => {
  const s = base();
  edit(s);
  return storyContentProblems(s);
};
const sample = (): Story =>
  StorySchema.parse({
    id: "tiny",
    title: "Tiny",
    synopsis: "s",
    setting: "s",
    tone: "t",
    characters: [
      { id: "ann", name: "Ann", role: "r", personality: "p", speechStyle: "s", unlockPhase: "p1", secrets: [], knowledgeByPhase: { p1: "Ann hands over the Brass Key. She cheers when she sees the Gold Coin." } },
      { id: "bob", name: "Bob", role: "r", personality: "p", speechStyle: "s", unlockPhase: "p2", secrets: [], knowledgeByPhase: { p2: "Bob gives the Old Map." } },
    ],
    phases: [
      { id: "p1", title: "a", narration: "n", objective: "o", completionCriteria: "c" },
      { id: "p2", title: "b", narration: "n", objective: "o", completionCriteria: "c", requiredItems: ["key"] },
    ],
    items: [
      { id: "badge", name: "Badge", description: "d", source: "start", availablePhase: "p1" },
      { id: "key", name: "Brass Key", description: "d", source: "found", availablePhase: "p1", obtainCriteria: "Ann has given the player the key." },
      { id: "coin", name: "Gold Coin", description: "d", source: "ad", availablePhase: "p1" },
      { id: "map", name: "Old Map", description: "d", source: "found", availablePhase: "p2", obtainCriteria: "Bob gave the map." },
    ],
  });

describe("storyContentProblems", () => {
  it("accepts the Midnight Manor story", () => assert.deepEqual(problems(() => {}), []));

  it("rejects too few or too many items", () => {
    assert.ok(problems((s) => (s.items = s.items.slice(0, 3))).some((p) => /4 to 7 items, got 3/.test(p)));
    assert.ok(problems((s) => (s.items = [...s.items, ...s.items.map((i) => ({ ...i, id: i.id + "-2" })) ])).some((p) => /4 to 7 items/.test(p)));
  });

  it("rejects a missing source kind", () => {
    for (const source of ["start", "found", "ad"] as const) {
      const p = problems((s) => (s.items = s.items.filter((i) => i.source !== source)));
      assert.ok(p.some((x) => x.includes(`no "${source}" item`)), source);
    }
  });

  it("needs at least one phase with requiredItems", () => {
    assert.ok(problems((s) => s.phases.forEach((p) => (p.requiredItems = []))).some((p) => /no phase has requiredItems/.test(p)));
  });

  it("rejects a required ad item outside the fixture list", () => {
    assert.deepEqual(problems(() => {}), []);
    assert.ok(problems((s) => (s.phases[3].requiredItems = ["orchard-key"])).some((p) => /requires the ad item "orchard-key"/.test(p)));
    assert.ok(problems((s) => (s.id = "other-story")).some((p) => /requires the ad item "solicitors-carbon"/.test(p)));
  });

  it("rejects an ad item required by the first phase", () => {
    assert.ok(problems((s) => (s.phases[0].requiredItems = ["solicitors-carbon"])).some((p) => /first/.test(p)));
  });

  it("rejects a found item nobody mentions in time", () => {
    assert.deepEqual(problems(() => {}, sample), []);
    // Only Bob (unlocks p2) mentions the key, but p2 requires it: Bob is reachable, so still fine.
    assert.deepEqual(problems((s) => { s.characters[0].knowledgeByPhase = { p1: "Ann cheers at the Gold Coin." }; s.characters[1].knowledgeByPhase = { p2: "Bob has the brass key. Old Map." }; }, sample), []);
    // Nobody mentions it at all.
    assert.ok(problems((s) => { s.characters[0].knowledgeByPhase = { p1: "Ann cheers at the Gold Coin." }; }, sample).some((p) => /found item "key"/.test(p)));
    // The only mention comes from a character who unlocks after the item is required.
    const late = sample();
    late.phases[0].requiredItems = ["key"];
    late.phases[1].requiredItems = [];
    late.characters[0].knowledgeByPhase = { p1: "Ann cheers at the Gold Coin." };
    late.characters[1].knowledgeByPhase = { p2: "Bob has the Brass Key and the Old Map." };
    assert.ok(storyContentProblems(late).some((p) => /found item "key"/.test(p)));
  });

  it("matches names case-insensitively and in NFC", () => {
    const s = sample();
    s.items[1].name = "Chìa khoá";
    s.characters[0].knowledgeByPhase = { p1: "CHÌA KHOÁ".normalize("NFD") + " nằm đây. Gold Coin." };
    assert.deepEqual(storyContentProblems(s), []);
  });

  it("rejects an ad item nobody reacts to", () => {
    const p = problems((s) => (s.characters[0].knowledgeByPhase = { p1: "Ann hands over the Brass Key." }), sample);
    assert.ok(p.some((x) => /ad item "coin"/.test(x)));
    // A mention in secrets does not count for an ad item: someone must react to it.
    const s = sample();
    s.characters[0].knowledgeByPhase = { p1: "Ann hands over the Brass Key." };
    s.characters[0].secrets = ["She loves the Gold Coin."];
    assert.ok(storyContentProblems(s).some((x) => /ad item "coin"/.test(x)));
  });

  it("reports the schema's own item issues", () => {
    assert.ok(problems((s) => (s.phases[1].requiredItems = ["ghost"]), sample).some((p) => /does not exist/.test(p)));
  });
});

describe("giversOf and holdersOf", () => {
  const cast = [
    { id: "mrs-hale", name: "Mrs. Hale", unlockPhase: "p1", concept: "Keeps a secret." },
    { id: "julian", name: "Julian", unlockPhase: "p1", concept: "Hid the torn ledger page." },
  ];
  it("finds the giver by name or id", () => {
    assert.deepEqual(giversOf({ obtainCriteria: "Mrs. Hale has handed over the shard." }, cast).map((c) => c.id), ["mrs-hale"]);
    assert.deepEqual(giversOf({ obtainCriteria: "julian gave it." }, cast).map((c) => c.id), ["julian"]);
    assert.deepEqual(giversOf({ obtainCriteria: "" }, cast), []);
  });
  it("matches the last word of a character name", () => {
    const people = [
      { id: "agnes", name: "Mrs. Agnes Hale", unlockPhase: "p1" },
      { id: "ba-hoa", name: "Bà Hoa", unlockPhase: "p1" },
      { id: "jo", name: "Jo Li", unlockPhase: "p1" },
    ];
    assert.deepEqual(giversOf({ obtainCriteria: "Mrs. Hale has handed over the shard." }, people).map((c) => c.id), ["agnes"]);
    assert.deepEqual(giversOf({ obtainCriteria: "Hoa đã đưa cho người chơi lọ thuốc." }, people).map((c) => c.id), ["ba-hoa"]);
    assert.deepEqual(giversOf({ obtainCriteria: "Li gave it." }, people), []);
  });
  it("adds characters whose concept mentions the item", () => {
    const item = { id: "ledger-page", name: "Torn ledger page", obtainCriteria: "Mrs. Hale gave it." };
    assert.deepEqual(holdersOf(item, cast).map((c) => c.id).sort(), ["julian", "mrs-hale"]);
  });
});
