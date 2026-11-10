import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dataDir = mkdtempSync(join(tmpdir(), "drama-items-"));
process.env.DATA_DIR = dataDir;
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.DEEPSEEK_API_KEY = "sk-test-not-real";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { SESSION_COOKIE, requestCode, verifyCode } from "../lib/auth";
import { db, MIGRATIONS } from "../lib/db";
import { judgeTurn } from "../lib/director";
import { adItemIds, findableItems, grantAdItem, missingRequired, ownedItemIds, toPublicItems } from "../lib/items";
import { showItemLine } from "../lib/items-shared";
import { outlineProblems } from "../lib/llm";
import { characterSystemPrompt, judgePrompt } from "../lib/prompts";
import { StorySchema, type JudgeResult, type Story, type StoryOutline } from "../lib/schema";
import { getStory, listStories, toPublicStory } from "../lib/stories";
import { freshTicket, reissue, signTicket } from "../lib/ticket";
import { decodeTicketPayload, type TicketPayload } from "../lib/ticket-payload";
import { POST as chatPOST } from "../app/api/stories/[id]/chat/[charId]/route";
import { POST as groupPOST } from "../app/api/stories/[id]/group-chat/route";
import { GET as storyGET } from "../app/api/stories/[id]/route";
import { POST as resetPOST } from "../app/api/stories/[id]/reset/route";
import { POST as itemsPOST } from "../app/api/items/route";

const raw = (file: string) => JSON.parse(readFileSync(join(__dirname, "..", "stories", `${file}.json`), "utf8"));
const manor: Story = StorySchema.parse(raw("sample-midnight-manor"));
const saigon: Story = StorySchema.parse(raw("sai-gon-2077"));
const SID = manor.id;

const payload = (p: number, f: string[] = [], story: Story = manor): TicketPayload => ({
  ...decodeTicketPayload(freshTicket(1, story.id))!,
  p,
  f,
});
const startIds = (story: Story) => new Set(story.items.filter((i) => i.source === "start").map((i) => i.id));

describe("story files with items", () => {
  it("all stories parse", () => {
    assert.equal(listStories().length, 8);
  });

  it("Midnight Manor and Sài Gòn 2077 have three items and one requirement each", () => {
    for (const [story, required] of [[manor, "solicitors-carbon"], [saigon, "chip-ghi-nho"]] as const) {
      assert.equal(story.items.length, 3);
      assert.deepEqual(story.items.map((i) => i.source).sort(), ["ad", "found", "start"]);
      const withReq = story.phases.filter((p) => p.requiredItems.length > 0);
      assert.equal(withReq.length, 1);
      assert.equal(withReq[0].id, "p3");
      assert.deepEqual(withReq[0].requiredItems, [required]);
    }
  });
});

describe("StorySchema item rules", () => {
  const base = () => raw("sample-midnight-manor");
  const issues = (mutate: (s: any) => void) => {
    const s = base();
    mutate(s);
    const r = StorySchema.safeParse(s);
    return r.success ? [] : r.error.issues.map((i) => ({ message: i.message, path: i.path.join(".") }));
  };

  it("a valid story passes", () => {
    assert.ok(StorySchema.safeParse(base()).success);
  });

  it("a story without items is still valid", () => {
    const s = base();
    delete s.items;
    for (const p of s.phases) delete p.requiredItems;
    const r = StorySchema.safeParse(s);
    assert.ok(r.success);
    assert.deepEqual(r.data!.items, []);
  });

  it("unique item ids", () => {
    const found = issues((s) => (s.items[1].id = "gala-invitation"));
    assert.ok(found.some((i) => /duplicate item id/.test(i.message) && i.path === "items.1.id"), JSON.stringify(found));
  });

  it("availablePhase is a phase id", () => {
    const found = issues((s) => (s.items[0].availablePhase = "p9"));
    assert.ok(found.some((i) => /not a phase id/.test(i.message) && i.path === "items.0.availablePhase"));
  });

  it("start items are available in the first phase", () => {
    const found = issues((s) => (s.items[0].availablePhase = "p2"));
    assert.ok(found.some((i) => /first phase/.test(i.message) && i.path === "items.0.availablePhase"));
  });

  it("found items need a non-empty obtainCriteria (null and empty count as missing)", () => {
    for (const value of [undefined, null, "", "   "]) {
      const found = issues((s) => {
        if (value === undefined) delete s.items[1].obtainCriteria;
        else s.items[1].obtainCriteria = value;
      });
      assert.ok(found.some((i) => /needs an obtainCriteria/.test(i.message) && i.path === "items.1.obtainCriteria"), String(value));
    }
  });

  it("start and ad items have no obtainCriteria", () => {
    assert.ok(issues((s) => (s.items[0].obtainCriteria = "x")).some((i) => /must not have an obtainCriteria/.test(i.message) && i.path === "items.0.obtainCriteria"));
    assert.ok(issues((s) => (s.items[2].obtainCriteria = "x")).some((i) => /must not have an obtainCriteria/.test(i.message) && i.path === "items.2.obtainCriteria"));
  });

  it("every requiredItems id exists", () => {
    const found = issues((s) => (s.phases[1].requiredItems = ["nope"]));
    assert.ok(found.some((i) => /does not exist/.test(i.message) && i.path === "phases.1.requiredItems.0"));
  });

  it("a required item must be available by the requiring phase", () => {
    const found = issues((s) => (s.phases[1].requiredItems = ["solicitors-carbon"]));
    assert.ok(found.some((i) => /after this phase/.test(i.message) && i.path === "phases.1.requiredItems.0"));
  });

  it("the first phase does not require an ad item", () => {
    const found = issues((s) => {
      s.items[2].availablePhase = "p1";
      s.phases[0].requiredItems = ["solicitors-carbon"];
    });
    assert.ok(found.some((i) => /first phase cannot require the ad item/.test(i.message) && i.path === "phases.0.requiredItems.0"));
  });

  it("an ad item may be required after the first phase (the Midnight Manor fixture)", () => {
    assert.ok(StorySchema.safeParse(base()).success);
    assert.deepEqual(manor.phases[2].requiredItems, ["solicitors-carbon"]);
  });
});

describe("ownership and gates", () => {
  before(() => {
    db();
  });

  it("migration v2 creates user_items", () => {
    assert.equal(db().pragma("user_version", { simple: true }), 2);
    assert.equal(MIGRATIONS.length, 2);
    assert.ok(db().prepare("SELECT 1 FROM sqlite_master WHERE name = 'user_items'").get());
  });

  it("ownedItemIds: start implied, ticket f, ad rows", () => {
    const uid = 501;
    db().prepare("INSERT INTO users (id, email, display_name, created_at, last_login_at) VALUES (?, 'own@example.com', 'o', 1, 1)").run(uid);
    assert.deepEqual([...ownedItemIds(uid, manor, payload(0))].sort(), ["gala-invitation"]);
    assert.deepEqual([...ownedItemIds(uid, manor, payload(1, ["glass-shard"]))].sort(), ["gala-invitation", "glass-shard"]);
    // ids in f that are not found items of the story are ignored
    assert.deepEqual([...ownedItemIds(uid, manor, payload(1, ["solicitors-carbon", "zzz"]))].sort(), ["gala-invitation"]);
    grantAdItem(uid, SID, "solicitors-carbon", "ad-1", 5);
    grantAdItem(uid, SID, "solicitors-carbon", "ad-2", 9); // INSERT OR IGNORE
    grantAdItem(uid, saigon.id, "dau-an-long-mach", null);
    assert.deepEqual([...adItemIds(uid, SID)], ["solicitors-carbon"]);
    const row = db().prepare("SELECT acquired_at, ad_session_id FROM user_items WHERE user_id = ? AND item_id = 'solicitors-carbon'").get(uid);
    assert.deepEqual(row, { acquired_at: 5, ad_session_id: "ad-1" });
    assert.deepEqual([...ownedItemIds(uid, manor, payload(2, ["glass-shard"]))].sort(), ["gala-invitation", "glass-shard", "solicitors-carbon"]);
    // ad rows of another story do not leak across
    assert.ok(!ownedItemIds(uid, saigon, payload(0, [], saigon)).has("solicitors-carbon"));
    assert.ok(ownedItemIds(uid, saigon, payload(0, [], saigon)).has("dau-an-long-mach"));
  });

  it("missingRequired", () => {
    assert.deepEqual(missingRequired(manor, 2, startIds(manor)), ["solicitors-carbon"]);
    assert.deepEqual(missingRequired(manor, 2, new Set(["solicitors-carbon"])), []);
    assert.deepEqual(missingRequired(manor, 0, new Set()), []);
    assert.deepEqual(missingRequired(manor, manor.phases.length, new Set()), []);
    assert.deepEqual(missingRequired(saigon, 2, startIds(saigon)), ["chip-ghi-nho"]);
  });

  it("findableItems: found only, available by now, not owned", () => {
    assert.deepEqual(findableItems(manor, 0, startIds(manor)).map((i) => i.id), ["glass-shard"]);
    assert.deepEqual(findableItems(manor, 3, new Set(["glass-shard"])).map((i) => i.id), []);
    // chip-ghi-nho is available from p2: not findable in p1
    assert.deepEqual(findableItems(saigon, 0, startIds(saigon)).map((i) => i.id), []);
    assert.deepEqual(findableItems(saigon, 1, startIds(saigon)).map((i) => i.id), ["chip-ghi-nho"]);
  });

  it("toPublicItems hides future items and unowned found descriptions, never obtainCriteria", () => {
    const owned = startIds(manor);
    const at0 = toPublicItems(manor, 0, owned);
    assert.deepEqual(at0.map((i) => i.id), ["gala-invitation", "glass-shard"]);
    assert.equal(at0[0].owned, true);
    assert.ok(at0[0].description.length > 0);
    assert.equal(at0[1].owned, false);
    assert.equal(at0[1].description, "");
    assert.equal(at0[1].availablePhaseIndex, 0);
    // an ad item from a later chapter shows up once owned, even early
    const withAd = toPublicItems(manor, 0, new Set([...owned, "solicitors-carbon"]));
    assert.ok(withAd.find((i) => i.id === "solicitors-carbon")?.owned);
    // at its chapter an unowned ad item is listed, with its description
    const at2 = toPublicItems(manor, 2, owned);
    const carbon = at2.find((i) => i.id === "solicitors-carbon")!;
    assert.equal(carbon.owned, false);
    assert.ok(carbon.description.length > 0);
    // owning a found item reveals its description
    const shard = toPublicItems(manor, 1, new Set([...owned, "glass-shard"])).find((i) => i.id === "glass-shard")!;
    assert.ok(shard.description.length > 0);
    for (const p of [0, 1, 2, 3, 4]) {
      const json = JSON.stringify(toPublicItems(manor, p, owned));
      for (const item of manor.items) if (item.obtainCriteria) assert.ok(!json.includes(item.obtainCriteria));
      assert.ok(!json.includes("obtainCriteria"));
    }
  });

  it("showItemLine", () => {
    assert.equal(showItemLine({ emoji: "💌", name: "Gala invitation" }), "*shows 💌 Gala invitation*");
  });
});

describe("judgeTurn with items", () => {
  const base = { recent: [], events: [], notes: "", groupMembers: new Map<number, string[]>() };
  const verdict = (v: Partial<JudgeResult>) => async (): Promise<JudgeResult> => ({
    completed: false, reason: "", eventSummary: "", notes: "n", grantedItemIds: [], ...v,
  });
  // A copy of Midnight Manor where chapter 2 needs the (found) glass shard and chapter 3 needs nothing.
  const gated: Story = StorySchema.parse({
    ...raw("sample-midnight-manor"),
    phases: raw("sample-midnight-manor").phases.map((p: any) => ({ ...p, requiredItems: p.id === "p2" ? ["glass-shard"] : [] })),
  });

  it("the judge is told what is carried, what is required and what can be found", async () => {
    let prompt = "";
    await judgeTurn(
      { ...base, story: gated, ticket: payload(1, [], gated), owned: startIds(gated) },
      async (story, p, recent, events, notes, groupMembers, owned) => {
        prompt = judgePrompt(story, p, recent, events, notes, groupMembers, owned);
        return { completed: false, reason: "", eventSummary: "", notes: "", grantedItemIds: [] };
      }
    );
    assert.match(prompt, /Items the player carries: 💌 Gala invitation/);
    assert.match(prompt, /Required to finish this chapter: Shard of the brandy glass \(missing\)/);
    assert.match(prompt, /the game itself blocks completion while a required item is missing/);
    assert.match(prompt, /Items the player can find now/);
    assert.match(prompt, /- id "glass-shard": Shard of the brandy glass — condition: Mrs\. Hale has handed/);
    assert.match(prompt, /"grantedItemIds"/);
    // no item sections noise when nothing applies
    const plain = judgePrompt(manor, 1, [], [], "", undefined, new Set(["glass-shard", ...startIds(manor)]));
    assert.match(plain, /Items the player carries: 💌 Gala invitation, 🥃 Shard of the brandy glass/);
    assert.doesNotMatch(plain, /Required to finish/);
    assert.doesNotMatch(plain, /Items the player can find now/);
  });

  it("completed while a required item is missing: no advance, blockedByItemIds, ticket echoed", async () => {
    const rawTicket = freshTicket(1, manor.id);
    const t = { ...decodeTicketPayload(rawTicket)!, p: 2 };
    const d = await judgeTurn(
      { ...base, story: manor, ticket: t, ticketString: rawTicket, owned: startIds(manor) },
      verdict({ completed: true })
    );
    assert.equal(d.phaseAdvanced, false);
    assert.deepEqual(d.blockedByItemIds, ["solicitors-carbon"]);
    assert.equal(d.notes, "n");
    assert.equal(d.phaseIndex, 2);
    assert.equal(d.ticket, rawTicket);
    assert.deepEqual(d.itemsFound, []);
    assert.equal(d.eventSummary, undefined);
  });

  it("the required ad item owned: the chapter advances", async () => {
    const d = await judgeTurn(
      { ...base, story: manor, ticket: payload(2), owned: new Set([...startIds(manor), "solicitors-carbon"]) },
      verdict({ completed: true })
    );
    assert.equal(d.phaseAdvanced, true);
    assert.equal(d.blockedByItemIds, undefined);
    assert.equal(decodeTicketPayload(d.ticket)!.p, 3);
  });

  it("item granted and the chapter requiring it completed in the same turn: advances", async () => {
    const t = payload(1, [], gated);
    const d = await judgeTurn(
      { ...base, story: gated, ticket: t, owned: startIds(gated) },
      verdict({ completed: true, grantedItemIds: ["glass-shard"] })
    );
    assert.equal(d.phaseAdvanced, true);
    assert.equal(d.blockedByItemIds, undefined);
    assert.deepEqual(d.itemsFound.map((i) => [i.id, i.owned]), [["glass-shard", true]]);
    assert.ok(d.itemsFound[0].description.length > 0);
    const out = decodeTicketPayload(d.ticket)!;
    assert.equal(out.p, 2);
    assert.deepEqual(out.f, ["glass-shard"]);
    assert.equal(out.r, t.r);
  });

  it("item granted, chapter not completed: ticket reissued with the sorted, unique f", async () => {
    const withTwo: Story = StorySchema.parse({
      ...raw("sample-midnight-manor"),
      items: [
        ...raw("sample-midnight-manor").items,
        { id: "aaa-note", name: "Note", emoji: "📝", description: "A note.", source: "found", availablePhase: "p1", obtainCriteria: "Julian gave the player a note." },
      ],
    });
    const rawTicket = freshTicket(1, withTwo.id);
    const t = decodeTicketPayload(rawTicket)!;
    const d = await judgeTurn(
      { ...base, story: withTwo, ticket: t, ticketString: rawTicket, owned: startIds(withTwo) },
      verdict({ grantedItemIds: ["glass-shard", "aaa-note", "glass-shard"] })
    );
    assert.equal(d.phaseAdvanced, false);
    assert.notEqual(d.ticket, rawTicket);
    assert.deepEqual(decodeTicketPayload(d.ticket)!.f, ["aaa-note", "glass-shard"]);
    assert.equal(decodeTicketPayload(d.ticket)!.p, 0);
    assert.deepEqual(d.itemsFound.map((i) => i.id), ["glass-shard", "aaa-note"]);
  });

  it("a grant that is not findable now is ignored", async () => {
    const withLate: Story = StorySchema.parse({
      ...raw("sample-midnight-manor"),
      items: [
        ...raw("sample-midnight-manor").items,
        { id: "late-note", name: "Late note", emoji: "📝", description: "A note.", source: "found", availablePhase: "p3", obtainCriteria: "Clara gave the player a note." },
      ],
    });
    const rawTicket = freshTicket(1, withLate.id);
    const t = decodeTicketPayload(rawTicket)!;
    const owned = new Set([...startIds(withLate), "glass-shard"]); // already owned
    for (const id of ["late-note" /* wrong phase */, "solicitors-carbon" /* ad */, "glass-shard" /* owned */, "gala-invitation" /* start */, "nonexistent"]) {
      const d = await judgeTurn(
        { ...base, story: withLate, ticket: { ...t, f: ["glass-shard"] }, ticketString: rawTicket, owned },
        verdict({ grantedItemIds: [id] })
      );
      assert.deepEqual(d.itemsFound, [], id);
      assert.equal(d.ticket, rawTicket, id);
    }
  });

  it("a finished story makes no judge call and finds nothing", async () => {
    let calls = 0;
    const d = await judgeTurn({ ...base, story: manor, ticket: payload(manor.phases.length), owned: startIds(manor) }, async () => {
      calls++;
      return { completed: true, reason: "", eventSummary: "", notes: "x", grantedItemIds: ["glass-shard"] };
    });
    assert.equal(calls, 0);
    assert.deepEqual(d.itemsFound, []);
  });
});

describe("prompts", () => {
  const char = manor.characters.find((c) => c.id === "mrs-hale")!;
  it("character prompt lists what the player carries", () => {
    const p = characterSystemPrompt(manor, char, 0, [], {
      carrying: manor.items.filter((i) => i.source === "start").map(({ name, emoji, description }) => ({ name, emoji, description })),
    });
    assert.match(p, /## What the player is carrying\n- 💌 Gala invitation: A gilt-edged card/);
    assert.match(p, /react with disbelief/);
    assert.doesNotMatch(p, /Right now the player is showing you/);
    assert.ok(p.indexOf("What you know right now") < p.indexOf("What the player is carrying"));
    assert.match(characterSystemPrompt(manor, char, 0, []), /## What the player is carrying\n- Nothing of note\./);
  });

  it("a shown item adds the 'showing you' line", () => {
    const item = manor.items[0];
    const p = characterSystemPrompt(manor, char, 0, [], { carrying: [item], shownItem: item });
    assert.match(p, new RegExp(`Right now the player is showing you: ${item.emoji} ${item.name} \\(A gilt-edged card.*\\)\\. React to it\\.`));
  });
});

describe("outlineProblems: item rules", () => {
  const phase = (id: string, requiredItems: string[] = []) => ({ id, title: id, narration: "n", objective: "o", completionCriteria: "c", hint: "", requiredItems });
  const good = (): StoryOutline => ({
    id: "s", title: "t", synopsis: "s", setting: "s", tone: "t",
    phases: [phase("p1"), phase("p2", ["shard"]), phase("p3")],
    items: [
      { id: "card", name: "Card", emoji: "💌", description: "d", source: "start", availablePhase: "p1" },
      { id: "shard", name: "Shard", emoji: "🥃", description: "d", source: "found", availablePhase: "p1", obtainCriteria: "X has given the player the shard." },
      { id: "key", name: "Key", emoji: "🗝️", description: "d", source: "found", availablePhase: "p2", obtainCriteria: "Y has given the player the key." },
      { id: "carbon", name: "Carbon", emoji: "📜", description: "d", source: "ad", availablePhase: "p2" },
    ],
    characters: [["a", "p1"], ["b", "p1"], ["c", "p2"], ["d", "p3"]].map(([id, unlockPhase]) => ({ id, name: id, role: "r", avatarEmoji: "x", unlockPhase, concept: "c" })),
  });

  it("accepts a valid outline", () => {
    assert.equal(outlineProblems(good(), 3, 4), "");
  });

  it("rejects an ad item in requiredItems", () => {
    const o = good();
    o.phases[2].requiredItems = ["carbon"];
    assert.match(outlineProblems(o, 3, 4), /"carbon" is an ad item; ad items must never be required/);
  });

  it("rejects the wrong number of items and missing sources", () => {
    const o = good();
    o.items = o.items.slice(0, 3);
    const text = outlineProblems(o, 3, 4);
    assert.match(text, /Expected 4 to 6 items, got 3/);
    assert.match(text, /at least one "ad" item/);
    const many = good();
    many.items = [...many.items, ...many.items.map((i) => ({ ...i, id: i.id + "2" }))];
    assert.match(outlineProblems(many, 3, 4), /Expected 4 to 6 items, got 8/);
  });

  it("rejects a missing requirement from the second phase on", () => {
    const o = good();
    o.phases[1].requiredItems = [];
    assert.match(outlineProblems(o, 3, 4), /At least one phase from the second on must have requiredItems/);
  });

  it("applies the schema rules", () => {
    const noCriteria = good();
    noCriteria.items[1].obtainCriteria = "";
    assert.match(outlineProblems(noCriteria, 3, 4), /items\.1\.obtainCriteria: found item "shard" needs an obtainCriteria/);
    const lateStart = good();
    lateStart.items[0].availablePhase = "p2";
    assert.match(outlineProblems(lateStart, 3, 4), /start item "card" must be available in the first phase/);
    const unknown = good();
    unknown.phases[1].requiredItems = ["ghost"];
    assert.match(outlineProblems(unknown, 3, 4), /required item "ghost" does not exist/);
    const early = good();
    early.phases[0].requiredItems = ["key"];
    assert.match(outlineProblems(early, 3, 4), /only available from "p2", after this phase/);
    const dup = good();
    dup.items[3].id = "card";
    assert.match(outlineProblems(dup, 3, 4), /duplicate item id "card"/);
  });
});

// ---- routes ------------------------------------------------------------------------------------------------

const H = { origin: "http://localhost:3000", host: "localhost:3000" };
let cookie = "";
let uid = 0;

async function signIn(email: string) {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => void lines.push(a.join(" "));
  try { await requestCode(email, "ip-" + email, Date.now()); } finally { console.log = orig; }
  const code = /: (\d{6})/.exec(lines.join(""))![1];
  const r = verifyCode(email, code, "UA");
  if (!r.ok) throw new Error("no login");
  return { cookie: `${SESSION_COOKIE}=${r.token}`, id: r.user.id };
}

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${url}`, { method: "POST", headers: { "content-type": "application/json", ...H, ...headers }, body: JSON.stringify(body) });
const emptyContext = { recent: [], events: [], notes: "", groupMembers: {}, history: [], groupChats: [] };
const chatParams = (charId: string) => ({ params: Promise.resolve({ id: SID, charId }) });
const idParams = { params: Promise.resolve({ id: SID }) };
const firstChar = manor.characters.find((c) => c.unlockPhase === manor.phases[0].id)!;
const secondFirst = manor.characters.filter((c) => c.unlockPhase === manor.phases[0].id)[1];
const getStoryJson = async (ticket?: string) =>
  storyGET(new Request(`http://localhost:3000/api/stories/${SID}`, { headers: { cookie, ...(ticket ? { "x-save-ticket": ticket } : {}) } }), idParams);

/** Strings that must never reach the browser. */
function leaks(json: string, story: Story, opts: { ownedFound?: string[] } = {}): string[] {
  const found: string[] = [];
  for (const ph of story.phases) if (json.includes(ph.completionCriteria)) found.push("completionCriteria");
  for (const it of story.items) {
    if (it.obtainCriteria && json.includes(it.obtainCriteria)) found.push("obtainCriteria");
    if (it.source === "found" && !opts.ownedFound?.includes(it.id) && json.includes(it.description)) found.push(`description of ${it.id}`);
  }
  for (const c of story.characters) {
    for (const s of c.secrets) if (json.includes(s)) found.push("secret");
    if (json.includes(c.speechStyle)) found.push("speechStyle");
    for (const k of Object.values(c.knowledgeByPhase)) if (json.includes(k)) found.push("knowledgeByPhase");
  }
  if (json.includes("obtainCriteria")) found.push("obtainCriteria key");
  return found;
}

describe("item routes", () => {
  before(async () => {
    const u = await signIn("items@example.com");
    cookie = u.cookie;
    uid = u.id;
  });

  it("chat route: a hand-added unknown id in the ticket's f is 400 ticket_invalid", async () => {
    for (const f of [["nope"], ["gala-invitation"], ["solicitors-carbon"]]) {
      const t = signTicket({ uid, sid: SID, r: "r", p: 0, f });
      const res = await chatPOST(post(`/api/stories/${SID}/chat/${firstChar.id}`, { message: "hi", context: emptyContext }, { cookie, "x-save-ticket": t }), chatParams(firstChar.id));
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, "ticket_invalid");
    }
    const res = await storyGET(new Request(`http://localhost:3000/api/stories/${SID}`, { headers: { cookie, "x-save-ticket": signTicket({ uid, sid: SID, r: "r", p: 0, f: ["nope"] }) } }), idParams);
    assert.equal(res.status, 400);
  });

  it("chat route: showItemId not owned is 403 item_not_owned (found-not-found, ad, unknown)", async () => {
    const ticket = freshTicket(uid, SID);
    for (const showItemId of ["glass-shard", "solicitors-carbon", "nope"]) {
      const res = await chatPOST(
        post(`/api/stories/${SID}/chat/${firstChar.id}`, { message: `*shows x*`, showItemId, context: emptyContext }, { cookie, "x-save-ticket": ticket }),
        chatParams(firstChar.id)
      );
      assert.equal(res.status, 403, showItemId);
      assert.equal((await res.json()).code, "item_not_owned");
    }
  });

  it("chat route: an owned item passes the check (reaches the no-key 503); so does a found item in the ticket", async () => {
    const saved = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      for (const [showItemId, f] of [["gala-invitation", []], ["glass-shard", ["glass-shard"]]] as const) {
        const t = signTicket({ uid, sid: SID, r: "r", p: 0, f: [...f] });
        const res = await chatPOST(
          post(`/api/stories/${SID}/chat/${firstChar.id}`, { message: "*shows*", showItemId, context: emptyContext }, { cookie, "x-save-ticket": t }),
          chatParams(firstChar.id)
        );
        assert.equal(res.status, 503, showItemId);
        assert.equal((await res.json()).code, "no_api_key");
      }
    } finally {
      process.env.DEEPSEEK_API_KEY = saved;
    }
  });

  it("group chat route: showItemId not owned is 403 item_not_owned", async () => {
    const body = {
      message: "*shows x*", showItemId: "glass-shard",
      group: { id: 1, memberIds: [firstChar.id, secondFirst.id] },
      context: { ...emptyContext, history: [], privateChats: {} },
    };
    const res = await groupPOST(post(`/api/stories/${SID}/group-chat`, body, { cookie, "x-save-ticket": freshTicket(uid, SID) }), idParams);
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "item_not_owned");
  });

  it("GET story: items and required ids; the response never carries criteria, secrets or unowned found descriptions", async () => {
    const fresh = await getStoryJson();
    const text = await fresh.text();
    const d = JSON.parse(text);
    assert.deepEqual(d.story.items.map((i: { id: string }) => i.id), ["gala-invitation", "glass-shard"]);
    assert.equal(d.story.items[1].description, "");
    assert.deepEqual(leaks(text, manor), []);
    assert.deepEqual(d.story.currentPhase.requiredItemIds, []);

    // chapter 3 shows the requirement and the (unowned) ad item
    const t3 = signTicket({ uid, sid: SID, r: "r", p: 2, f: [] });
    const text3 = await (await getStoryJson(t3)).text();
    const d3 = JSON.parse(text3);
    assert.deepEqual(d3.story.currentPhase.requiredItemIds, ["solicitors-carbon"]);
    assert.ok(d3.story.items.some((i: { id: string; owned: boolean }) => i.id === "solicitors-carbon" && !i.owned));
    assert.deepEqual(leaks(text3, manor), []);

    // owning the found item reveals its description (and only that)
    const t1 = signTicket({ uid, sid: SID, r: "r", p: 1, f: ["glass-shard"] });
    const text1 = await (await getStoryJson(t1)).text();
    const shard = JSON.parse(text1).story.items.find((i: { id: string }) => i.id === "glass-shard");
    assert.equal(shard.owned, true);
    assert.ok(shard.description.length > 0);
    assert.deepEqual(leaks(text1, manor, { ownedFound: ["glass-shard"] }), []);

    // every chapter of every story, through the public view
    for (const story of [manor, saigon]) {
      for (let p = 0; p <= story.phases.length; p++) {
        assert.deepEqual(leaks(JSON.stringify(toPublicStory(story, p)), story), [], `${story.id} p${p}`);
      }
    }
  });

  it("the done event carries no criteria or secrets either", async () => {
    const gated: Story = StorySchema.parse({
      ...raw("sample-midnight-manor"),
      phases: raw("sample-midnight-manor").phases.map((p: any) => ({ ...p, requiredItems: p.id === "p2" ? ["glass-shard"] : [] })),
    });
    const d = await judgeTurn(
      { story: gated, ticket: payload(1, [], gated), owned: startIds(gated), recent: [], events: [], notes: "", groupMembers: new Map() },
      async () => ({ completed: true, reason: "", eventSummary: "", notes: "n", grantedItemIds: ["glass-shard"] })
    );
    assert.deepEqual(leaks(JSON.stringify(d), gated, { ownedFound: ["glass-shard"] }), []);
    const blocked = await judgeTurn(
      { story: manor, ticket: payload(2), owned: startIds(manor), recent: [], events: [], notes: "", groupMembers: new Map() },
      async () => ({ completed: true, reason: "", eventSummary: "", notes: "n", grantedItemIds: [] })
    );
    assert.deepEqual(leaks(JSON.stringify(blocked), manor), []);
  });

  it("POST /api/items: owned items only, per story; invalid tickets are skipped; no leaks", async () => {
    const guest = await itemsPOST(post("/api/items", { tickets: {} }));
    assert.equal(guest.status, 401);

    const tManor = signTicket({ uid, sid: SID, r: "r", p: 1, f: ["glass-shard"] });
    const body = { tickets: { [SID]: tManor, [saigon.id]: "junk", "unknown-story": tManor } };
    const res = await itemsPOST(post("/api/items", body, { cookie }));
    assert.equal(res.status, 200);
    const text = await res.text();
    const d = JSON.parse(text) as { stories: { storyId: string; title: string; items: { id: string; owned: boolean }[] }[] };
    // saigon has a bad ticket and no ad rows for this user: skipped
    assert.deepEqual(d.stories.map((s) => s.storyId), [SID]);
    assert.equal(d.stories[0].title, manor.title);
    assert.deepEqual(d.stories[0].items.map((i) => i.id), ["gala-invitation", "glass-shard"]);
    assert.ok(d.stories[0].items.every((i) => i.owned));
    assert.deepEqual(leaks(text, manor, { ownedFound: ["glass-shard"] }), []);

    // ad rows alone are enough (no ticket), and are listed with a ticket too
    grantAdItem(uid, saigon.id, "dau-an-long-mach", "ad-x");
    const res2 = await itemsPOST(post("/api/items", { tickets: {} }, { cookie }));
    const d2 = (await res2.json()) as typeof d;
    assert.deepEqual(d2.stories.map((s) => [s.storyId, s.items.map((i) => i.id)]), [[saigon.id, ["dau-an-long-mach"]]]);

    const bad = await itemsPOST(post("/api/items", { tickets: "x" }, { cookie }));
    assert.equal(bad.status, 400);
    const foreign = await itemsPOST(post("/api/items", { tickets: {} }, { cookie, origin: "https://evil.example" }));
    assert.equal(foreign.status, 403);
  });

  it("restart keeps ad items and drops found ones", async () => {
    grantAdItem(uid, SID, "solicitors-carbon", "ad-y");
    const before = JSON.parse(await (await getStoryJson(signTicket({ uid, sid: SID, r: "old", p: 2, f: ["glass-shard"] }))).text());
    const ownedBefore = before.story.items.filter((i: { owned: boolean }) => i.owned).map((i: { id: string }) => i.id).sort();
    assert.deepEqual(ownedBefore, ["gala-invitation", "glass-shard", "solicitors-carbon"]);

    const { ticket } = await (await resetPOST(post(`/api/stories/${SID}/reset`, {}, { cookie }), idParams)).json();
    assert.deepEqual(decodeTicketPayload(ticket)!.f, []);
    const after = JSON.parse(await (await getStoryJson(ticket)).text());
    const ownedAfter = after.story.items.filter((i: { owned: boolean }) => i.owned).map((i: { id: string }) => i.id).sort();
    assert.deepEqual(ownedAfter, ["gala-invitation", "solicitors-carbon"]);
    assert.equal(db().prepare("SELECT COUNT(*) n FROM user_items WHERE user_id = ? AND story_id = ?").get(uid, SID)?.["n" as never], 1);
  });

  it("reissue keeps f sorted and unique", () => {
    const t = payload(0);
    assert.deepEqual(decodeTicketPayload(reissue(t, { f: ["b", "a", "b"] }))!.f, ["a", "b"]);
    assert.deepEqual(decodeTicketPayload(reissue({ ...t, f: ["a"] }, { p: 1 }))!.f, ["a"]);
  });
});

describe("generated stories keep items", () => {
  it("getStory still serves the bundled sets with items", () => {
    assert.equal(getStory("sample-midnight-manor")!.items.length, 3);
    assert.equal(getStory("sai-gon-2077")!.items.length, 3);
  });
});
