import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "drama-health-"));
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GET } from "../app/api/health/route";

describe("GET /api/health", () => {
  it("answers 200 { ok: true, db: true } with no-store", async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { ok: true, db: true });
  });
});
