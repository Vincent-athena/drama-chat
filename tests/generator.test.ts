import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dropExtraCharacters, fixMismatchedBrackets, outlineProblems } from "../lib/llm";
import type { StoryOutline } from "../lib/schema";

describe("fixMismatchedBrackets", () => {
  it("leaves valid JSON untouched", () => {
    const raw = '{"a":[1,2,{"b":3}],"c":"d"}';
    assert.equal(fixMismatchedBrackets(raw), raw);
  });

  it('fixes an object closed with "]"', () => {
    const fixed = fixMismatchedBrackets('{"a":[{"b":1]]}');
    assert.equal(fixed, '{"a":[{"b":1}]}');
    assert.deepEqual(JSON.parse(fixed), { a: [{ b: 1 }] });
  });

  it('fixes an array closed with "}"', () => {
    assert.deepEqual(JSON.parse(fixMismatchedBrackets('{"a":[1,2}}')), { a: [1, 2] });
  });

  it("does not touch brackets inside strings", () => {
    const raw = '{"a":"]}[{","b":["x]"]}';
    assert.equal(fixMismatchedBrackets(raw), raw);
  });

  it("handles escaped quotes inside strings", () => {
    const raw = '{"a":"say \\"]\\" now","b":[1]}';
    assert.equal(fixMismatchedBrackets(raw), raw);
    assert.equal(fixMismatchedBrackets('{"a":"q\\"}","b":[1}}'), '{"a":"q\\"}","b":[1]}');
  });
});

function phase(id: string) {
  return { id, title: id, narration: "n", objective: "o", completionCriteria: "c", hint: "", requiredItems: [] as string[] };
}

function character(id: string, unlockPhase: string) {
  return { id, name: id, role: "r", avatarEmoji: "x", unlockPhase, concept: "c" };
}

/** Four valid items (start, found, found, ad) and a requirement in the second phase. */
function withItems(o: StoryOutline): StoryOutline {
  const [first, second] = o.phases.map((p) => p.id);
  o.items = [
    { id: "card", name: "Card", emoji: "💌", description: "d", source: "start", availablePhase: first },
    { id: "shard", name: "Shard", emoji: "🥃", description: "d", source: "found", availablePhase: first, obtainCriteria: "X has given the player the shard." },
    { id: "page", name: "Page", emoji: "📒", description: "d", source: "found", availablePhase: second, obtainCriteria: "Y has given the player the page." },
    { id: "carbon", name: "Carbon", emoji: "📜", description: "d", source: "ad", availablePhase: second },
  ];
  o.phases[1].requiredItems = ["shard"];
  return o;
}

function outline(phaseIds: string[], chars: [string, string][]): StoryOutline {
  return withItems({
    id: "s",
    title: "t",
    synopsis: "s",
    setting: "s",
    tone: "t",
    phases: phaseIds.map(phase),
    items: [],
    characters: chars.map(([id, p]) => character(id, p)),
  });
}

const good = () =>
  outline(["p1", "p2", "p3"], [["a", "p1"], ["b", "p1"], ["c", "p2"], ["d", "p3"]]);

describe("outlineProblems", () => {
  it("accepts a valid outline", () => {
    assert.equal(outlineProblems(good(), 3, 4), "");
  });

  it("reports wrong phase and character counts", () => {
    const text = outlineProblems(good(), 4, 5);
    assert.match(text, /Expected exactly 4 phases, got 3/);
    assert.match(text, /Expected exactly 5 characters, got 4: add 1/);
    assert.match(outlineProblems(good(), 3, 3), /remove 1/);
  });

  it("reports duplicate ids", () => {
    const o = outline(["p1", "p1", "p3"], [["a", "p1"], ["a", "p1"], ["c", "p3"]]);
    const text = outlineProblems(o, 3, 3);
    assert.match(text, /Phase ids must be unique/);
    assert.match(text, /Character ids must be unique/);
  });

  it("reports an unknown unlockPhase", () => {
    const o = good();
    o.characters[3].unlockPhase = "p9";
    assert.match(outlineProblems(o, 3, 4), /Character "d" has unlockPhase "p9"/);
  });

  it("requires exactly 2 characters in the first phase", () => {
    const one = outline(["p1", "p2", "p3"], [["a", "p1"], ["b", "p2"], ["c", "p2"], ["d", "p3"]]);
    assert.match(outlineProblems(one, 3, 4), /Exactly 2 characters must unlock in the first phase, but 1 do/);
    const three = outline(["p1", "p2", "p3"], [["a", "p1"], ["b", "p1"], ["c", "p1"], ["d", "p3"]]);
    assert.match(outlineProblems(three, 3, 4), /but 3 do/);
  });

  it("reports a later phase with no unlock", () => {
    const o = outline(["p1", "p2", "p3"], [["a", "p1"], ["b", "p1"], ["c", "p3"], ["d", "p3"]]);
    assert.match(outlineProblems(o, 3, 4), /none unlock in: p2/);
  });
});

describe("dropExtraCharacters", () => {
  it("does nothing when the count is right", () => {
    const o = good();
    assert.deepEqual(dropExtraCharacters(o, 4).characters, o.characters);
  });

  it("trims from the most crowded later phase, latest first", () => {
    const o = outline(
      ["p1", "p2", "p3"],
      [["a", "p1"], ["b", "p1"], ["c", "p2"], ["d", "p2"], ["e", "p2"], ["f", "p3"]]
    );
    assert.deepEqual(dropExtraCharacters(o, 5).characters.map((c) => c.id), ["a", "b", "c", "d", "f"]);
    assert.deepEqual(dropExtraCharacters(o, 4).characters.map((c) => c.id), ["a", "b", "c", "f"]);
  });

  it("never trims the first phase", () => {
    const o = outline(["p1", "p2"], [["a", "p1"], ["b", "p1"], ["c", "p1"], ["d", "p2"]]);
    const result = dropExtraCharacters(o, 1).characters.map((c) => c.id);
    assert.deepEqual(result, ["a", "b", "c"]);
  });

  it("does not mutate the input", () => {
    const o = outline(["p1", "p2"], [["a", "p1"], ["b", "p1"], ["c", "p2"], ["d", "p2"]]);
    dropExtraCharacters(o, 3);
    assert.equal(o.characters.length, 4);
  });
});
