import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "drama-open-"));
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.ADMIN_EMAILS = "boss@example.com";
delete process.env.OPEN_STORIES;

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { SESSION_COOKIE, requestCode, verifyCode } from "../lib/auth";
import { DEFAULT_OPEN_STORIES, openStoryIds } from "../lib/env";
import { GET as storyGET } from "../app/api/stories/[id]/route";
import { GET as storiesGET } from "../app/api/stories/route";

async function signIn(email: string) {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try { await requestCode(email, "ip-" + email, Date.now()); } finally { console.log = orig; }
  const code = /: (\d{6})/.exec(lines.join(""))![1];
  const r = verifyCode(email, code, "UA");
  if (!r.ok) throw new Error("no login");
  return `${SESSION_COOKIE}=${r.token}`;
}

let player = "";
let admin = "";
before(async () => {
  player = await signIn("player@example.com");
  admin = await signIn("boss@example.com");
});

const list = async (cookie?: string) =>
  (await (await storiesGET(new Request("http://localhost:3000/api/stories", cookie ? { headers: { cookie } } : {}))).json()).stories as { id: string; hidden?: true }[];
const open = (id: string, cookie: string) =>
  storyGET(new Request(`http://localhost:3000/api/stories/${id}`, { headers: { cookie } }), { params: Promise.resolve({ id }) });

describe("open stories", () => {
  it("OPEN_STORIES: unset is the two featured stories, '*' is all, otherwise a list", () => {
    assert.deepEqual(openStoryIds(), DEFAULT_OPEN_STORIES);
    process.env.OPEN_STORIES = "*";
    assert.equal(openStoryIds(), "all");
    process.env.OPEN_STORIES = " a , b ";
    assert.deepEqual(openStoryIds(), ["a", "b"]);
    delete process.env.OPEN_STORIES;
  });

  it("guests and players see only the open stories, with no hidden flag", async () => {
    for (const cookie of [undefined, player]) {
      const s = await list(cookie);
      assert.deepEqual(s.map((x) => x.id).sort(), [...DEFAULT_OPEN_STORIES].sort());
      assert.ok(s.every((x) => !("hidden" in x)));
    }
  });

  it("admins see every story, open ones first, closed ones flagged hidden", async () => {
    const s = await list(admin);
    assert.ok(s.length > DEFAULT_OPEN_STORIES.length);
    const firstHidden = s.findIndex((x) => x.hidden);
    assert.ok(s.slice(0, firstHidden).every((x) => DEFAULT_OPEN_STORIES.includes(x.id)));
    assert.ok(s.slice(firstHidden).every((x) => x.hidden && !DEFAULT_OPEN_STORIES.includes(x.id)));
  });

  it("a player gets 404 for a closed story by direct link; an admin can open it", async () => {
    assert.equal((await open("sample-midnight-manor", player)).status, 404);
    assert.equal((await open("sample-midnight-manor", admin)).status, 200);
    assert.equal((await open("journey-west-sequel", player)).status, 200);
  });
});
