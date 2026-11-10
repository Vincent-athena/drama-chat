import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { StorySchema } from "../lib/schema";

const dir = join(__dirname, "..", "stories");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

describe("stories", () => {
  it("has story files", () => {
    assert.ok(files.length > 0);
  });

  for (const file of files) {
    it(`${file} parses with StorySchema`, () => {
      const result = StorySchema.safeParse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      assert.ok(result.success, result.success ? "" : result.error.message);
    });
  }
});
