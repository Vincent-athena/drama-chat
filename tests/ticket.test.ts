process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StorySchema, type Story } from "../lib/schema";
import { freshTicket, reissue, signTicket, TicketError, verifyTicket } from "../lib/ticket";
import { decodeTicketPayload, preferTicket } from "../lib/ticket-payload";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const story: Story = StorySchema.parse(JSON.parse(readFileSync(join(__dirname, "..", "stories", "sample-midnight-manor.json"), "utf8")));
const other: Story = { ...story, id: "other-story" };

const reason = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof TicketError ? e.reason : `other:${e}`; }
  return "none";
};
const tamper = (t: string) => {
  const [p, m] = t.split(".");
  const obj = JSON.parse(Buffer.from(p, "base64url").toString());
  obj.p = obj.p + 1;
  return `${Buffer.from(JSON.stringify(obj)).toString("base64url")}.${m}`;
};
const mk = (r: string, p: number, f: string[] = []) => signTicket({ uid: 1, sid: story.id, r, p, f });

describe("ticket", () => {
  it("round-trips", () => {
    const t = freshTicket(7, story.id, 1234);
    const p = verifyTicket(t, 7, story);
    assert.deepEqual({ ...p, r: "x" }, { v: 1, uid: 7, sid: story.id, r: "x", p: 0, f: [], iat: 1234 });
    assert.deepEqual(decodeTicketPayload(t), p);
    const next = reissue(p, { p: 2 });
    const q = verifyTicket(next, 7, story);
    assert.equal(q.p, 2);
    assert.equal(q.r, p.r);
    assert.notEqual(freshTicket(7, story.id), freshTicket(7, story.id));
  });

  it("rejects bad tickets with the right reason", () => {
    const t = freshTicket(7, story.id);
    assert.equal(reason(() => verifyTicket(null, 7, story)), "missing");
    assert.equal(reason(() => verifyTicket("garbage", 7, story)), "malformed");
    assert.equal(reason(() => verifyTicket("a.b", 7, story)), "malformed");
    assert.equal(reason(() => verifyTicket(tamper(t), 7, story)), "signature");
    assert.equal(reason(() => verifyTicket(t, 8, story)), "user");
    assert.equal(reason(() => verifyTicket(t, 7, other)), "story");
    const high = signTicket({ uid: 7, sid: story.id, r: "r", p: story.phases.length + 1, f: [] });
    assert.equal(reason(() => verifyTicket(high, 7, story)), "range");
    const done = signTicket({ uid: 7, sid: story.id, r: "r", p: story.phases.length, f: [] });
    assert.equal(reason(() => verifyTicket(done, 7, story)), "none");
    const withItems = signTicket({ uid: 7, sid: story.id, r: "r", p: 0, f: ["x"] });
    assert.equal(reason(() => verifyTicket(withItems, 7, story)), "range");
    // known ids must be `found` items: a start or ad item in f is rejected, a found one is accepted
    const startInF = signTicket({ uid: 7, sid: story.id, r: "r", p: 0, f: ["gala-invitation"] });
    assert.equal(reason(() => verifyTicket(startInF, 7, story)), "range");
    const adInF = signTicket({ uid: 7, sid: story.id, r: "r", p: 0, f: ["solicitors-carbon"] });
    assert.equal(reason(() => verifyTicket(adInF, 7, story)), "range");
    const foundInF = signTicket({ uid: 7, sid: story.id, r: "r", p: 0, f: ["glass-shard"] });
    assert.equal(reason(() => verifyTicket(foundInF, 7, story)), "none");
  });

  it("preferTicket", () => {
    const a1 = mk("A", 1);
    const a2 = mk("A", 2);
    const b0 = mk("B", 0);
    assert.equal(preferTicket(null, a1), a1);
    assert.equal(preferTicket("junk", a1), a1);
    assert.equal(preferTicket(a1, a2), a2); // higher p wins
    assert.equal(preferTicket(a2, a1), a2); // lower p loses
    assert.equal(preferTicket(a1, b0), a1); // other run id: stale reply
    assert.equal(preferTicket(a2, b0, true), b0); // force
    const f0 = mk("A", 1, []);
    const f1 = mk("A", 1, ["k"]);
    assert.equal(preferTicket(f0, f1), f1); // equal p: more found wins
    assert.equal(preferTicket(f1, f0), f1);
    const tie1 = mk("A", 1);
    assert.equal(preferTicket(f0, tie1), tie1); // tie -> incoming
  });
});
