import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "drama-limits-"));
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";
process.env.DAILY_MESSAGE_CAP = "3";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestCode } from "../lib/auth";
import { dayKey, nextDayStart } from "../lib/day";
import { checkOrigin } from "../lib/http";
import { hit } from "../lib/limits";
import { admit } from "../lib/turn";

const T0 = 1_800_000_000_000;
const quiet = async <T>(fn: () => Promise<T>) => {
  const orig = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = orig; }
};

describe("limits", () => {
  it("code requests: 1 per minute per email", async () => {
    assert.equal((await quiet(() => requestCode("m@b.co", "ip-m", T0))).ok, true);
    const second = await quiet(() => requestCode("m@b.co", "ip-m", T0 + 30_000));
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.status, 429);
      assert.equal(second.code, "rate_limited");
      assert.ok((second.retryAfter ?? 0) > 0);
    }
    assert.equal((await quiet(() => requestCode("m@b.co", "ip-m", T0 + 61_000))).ok, true);
  });

  it("code requests: 5 per hour per email", async () => {
    // Space the requests 61 s apart inside one hour window.
    const base = Math.floor(T0 / 3600_000) * 3600_000 + 3600_000 * 5;
    const results: boolean[] = [];
    for (let i = 0; i < 6; i++) results.push((await quiet(() => requestCode("h@b.co", `ip-h${i}`, base + i * 61_000))).ok);
    assert.deepEqual(results, [true, true, true, true, true, false]);
  });

  it("code requests: 20 per hour per IP", async () => {
    const base = Math.floor(T0 / 3600_000) * 3600_000 + 3600_000 * 9;
    let okCount = 0;
    let lastOk = true;
    for (let i = 0; i < 21; i++) {
      const r = await quiet(() => requestCode(`u${i}@b.co`, "ip-shared", base + i * 1000));
      if (r.ok) okCount++;
      lastOk = r.ok;
    }
    assert.equal(okCount, 20);
    assert.equal(lastOk, false);
  });

  it("hit() counts within a window and reports retryAfter", () => {
    const a = hit("k", 10_000, 2, T0);
    const b = hit("k", 10_000, 2, T0 + 1);
    const c = hit("k", 10_000, 2, T0 + 2);
    assert.deepEqual([a.ok, b.ok, c.ok], [true, true, false]);
    assert.equal(c.count, 3);
    assert.ok(c.retryAfter >= 1 && c.retryAfter <= 10);
    assert.equal(hit("k", 10_000, 2, T0 + 10_000).ok, true); // next window
  });

  it("daily message cap trips at cap+1 and carries resetsAt", async () => {
    const now = Date.parse("2026-03-05T05:00:00Z");
    process.env.DEEPSEEK_API_KEY = "sk-test";
    try {
      assert.equal(admit(77, now), null);
      assert.equal(admit(77, now), null);
      assert.equal(admit(77, now), null);
      const blocked = admit(77, now);
      assert.ok(blocked);
      assert.equal(blocked!.status, 429);
      const body = await blocked!.json();
      assert.equal(body.code, "daily_cap");
      assert.equal(body.resetsAt, nextDayStart(now));
      // another user and the next day are unaffected
      assert.equal(admit(78, now), null);
      assert.equal(admit(77, nextDayStart(now) + 1000), null);
    } finally {
      delete process.env.DEEPSEEK_API_KEY;
    }
  });

  it("dayKey and nextDayStart around Asia/Ho_Chi_Minh midnight", () => {
    assert.equal(dayKey(Date.parse("2026-01-01T16:59:59Z"), "Asia/Ho_Chi_Minh"), "2026-01-01");
    assert.equal(dayKey(Date.parse("2026-01-01T17:00:00Z"), "Asia/Ho_Chi_Minh"), "2026-01-02");
    assert.equal(nextDayStart(Date.parse("2026-01-01T16:59:59Z"), "Asia/Ho_Chi_Minh"), Date.parse("2026-01-01T17:00:00Z"));
    assert.equal(nextDayStart(Date.parse("2026-01-01T17:00:00Z"), "Asia/Ho_Chi_Minh"), Date.parse("2026-01-02T17:00:00Z"));
    // a zone with DST: New York spring-forward day is 23 hours long
    assert.equal(nextDayStart(Date.parse("2026-03-08T06:00:00Z"), "America/New_York"), Date.parse("2026-03-09T04:00:00Z"));
  });

  it("checkOrigin: same, foreign and missing", () => {
    const mk = (origin: string | null, method = "POST") =>
      new Request("http://localhost:3000/x", { method, headers: { host: "localhost:3000", ...(origin ? { origin } : {}) } });
    assert.equal(checkOrigin(mk("http://localhost:3000")), null);
    assert.equal(checkOrigin(mk(null, "GET")), null);
    assert.equal(checkOrigin(mk("https://evil.example"))!.status, 403);
    assert.equal(checkOrigin(mk(null))!.status, 403);
    process.env.APP_ORIGIN = "https://drama.example.com";
    try {
      assert.equal(checkOrigin(mk("https://drama.example.com")), null);
      assert.equal(checkOrigin(mk("http://localhost:3000"))!.status, 403);
    } finally {
      delete process.env.APP_ORIGIN;
    }
  });
});
