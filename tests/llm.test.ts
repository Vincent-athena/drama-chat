import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import OpenAI from "openai";
import {
  createLlm,
  extractJson,
  isFallbackError,
  providersFromEnv,
  type ChatClient,
  type LlmLog,
  type ProviderConfig,
} from "../lib/llm-core";

const MSGS = [{ role: "user" as const, content: "hi" }];
const OK = '{"ok":true}';
const apiError = (status: number, message = "boom") => Object.assign(new Error(message), { status });
const completion = (content: string, finish = "stop") => ({ choices: [{ finish_reason: finish, message: { content } }] });
async function* chunks(parts: string[], failAfter?: Error) {
  for (const p of parts) yield { choices: [{ delta: { content: p } }] };
  if (failAfter) throw failAfter;
}

type Call = { params: any; opts: any };
function fake(handler: (params: any, call: number, opts: any) => any): ChatClient & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    chat: {
      completions: {
        async create(params: any, opts: any) {
          calls.push({ params, opts });
          return handler(params, calls.length, opts);
        },
      },
    },
  };
}
const provider = (name: "bytedance" | "deepseek", client: ChatClient, extra: Partial<ProviderConfig> = {}): ProviderConfig => ({
  name,
  client,
  models: { chat: `${name}-m`, speakers: `${name}-m`, judge: `${name}-m`, guide: `${name}-m`, story: `${name}-m` },
  jsonMode: "json_object",
  extraBody: {},
  ...extra,
});
const never = () => new Promise(() => {});
const T = { firstTokenMs: 30, jsonMs: 30, storyMs: 30 };
async function collect(g: AsyncGenerator<string>) {
  let out = "";
  for await (const s of g) out += s;
  return out;
}
const opts = { temperature: 0 };

describe("extractJson", () => {
  it("handles fences, prose, nested braces in strings and mismatched brackets", () => {
    assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(extractJson('Sure! Here it is: {"a":{"b":[1,2]}} Hope that helps {not json'), '{"a":{"b":[1,2]}}');
    assert.deepEqual(JSON.parse(extractJson('x {"s":"a } b { c \\" }","n":{"k":1}} y')!), { s: 'a } b { c " }', n: { k: 1 } });
    assert.deepEqual(JSON.parse(extractJson('{"a":{"b":1]}')!), { a: { b: 1 } });
    assert.equal(extractJson("no json here"), null);
    assert.equal(extractJson('{"a": nope}'), null);
    assert.equal(extractJson('{"a":1'), null);
  });
});

describe("isFallbackError", () => {
  it("classifies errors", () => {
    for (const s of [401, 403, 408, 409, 429, 500, 503]) assert.ok(isFallbackError(apiError(s)), String(s));
    assert.ok(isFallbackError(apiError(400, "Content Exists Risk")));
    assert.ok(isFallbackError(Object.assign(new Error("x"), { status: 400, code: "SensitiveContentDetected" })));
    assert.ok(isFallbackError(new OpenAI.APIConnectionError({ message: "down" })));
    assert.ok(!isFallbackError(apiError(400, "bad field")));
    assert.ok(!isFallbackError(new Error("bug")));
  });
});

describe("completeJson fallback", () => {
  const run = (p: ProviderConfig, b: ProviderConfig, extra = {}) => createLlm({ providers: [p, b], timeouts: T, ...extra });

  it("uses the primary when it works and reports the provider", async () => {
    const a = fake(() => completion(OK));
    const b = fake(() => completion(OK));
    const r = await run(provider("bytedance", a), provider("deepseek", b)).completeJson("judge", MSGS, opts);
    assert.deepEqual([r.provider, r.fallback, r.raw, r.model], ["bytedance", false, OK, "bytedance-m"]);
    assert.equal(b.calls.length, 0);
  });

  for (const [label, make] of [
    ["connection error", () => new OpenAI.APIConnectionError({ message: "down" })],
    ["429", () => apiError(429)],
    ["503", () => apiError(503)],
    ["401", () => apiError(401)],
    ["moderation refusal", () => apiError(400, "content_filter triggered")],
  ] as [string, () => Error][]) {
    it(`falls back on ${label}`, async () => {
      const a = fake(() => { throw make(); });
      const b = fake(() => completion(OK));
      const logs: LlmLog[] = [];
      const r = await run(provider("bytedance", a), provider("deepseek", b), { log: (e: LlmLog) => logs.push(e) }).completeJson("chat", MSGS, opts);
      assert.deepEqual([r.provider, r.fallback], ["deepseek", true]);
      assert.deepEqual(logs.map((l) => [l.provider, l.ok, l.fallback]), [["bytedance", false, false], ["deepseek", true, true]]);
    });
  }

  it("falls back on a content_filter finish reason", async () => {
    const a = fake(() => completion("", "content_filter"));
    const b = fake(() => completion(OK));
    assert.equal((await run(provider("bytedance", a), provider("deepseek", b)).completeJson("chat", MSGS, opts)).provider, "deepseek");
  });

  it("falls back on timeout (never resolves) and aborts the request", async () => {
    const a = fake(never);
    const b = fake(() => completion(OK));
    const r = await run(provider("bytedance", a), provider("deepseek", b)).completeJson("judge", MSGS, opts);
    assert.equal(r.provider, "deepseek");
    assert.equal(a.calls[0].opts.signal.aborted, true);
    assert.equal(a.calls[0].opts.timeout, 30);
  });

  it("story tasks use the story timeout", async () => {
    const a = fake(() => completion(OK));
    await createLlm({ providers: [provider("deepseek", a)], timeouts: { jsonMs: 5, storyMs: 77 } }).completeJson("story", MSGS, opts);
    assert.equal(a.calls[0].opts.timeout, 77);
  });

  it("an unrelated 400 throws and the backup is not called", async () => {
    const a = fake(() => { throw apiError(400, "messages: invalid"); });
    const b = fake(() => completion(OK));
    await assert.rejects(run(provider("bytedance", a), provider("deepseek", b)).completeJson("chat", MSGS, opts), /invalid/);
    assert.equal(b.calls.length, 0);
  });

  it("a 400 about thinking is retried without it and remembered", async () => {
    const a = fake((p) => { if ("thinking" in p) throw apiError(400, "unknown field: thinking"); return completion(OK); });
    const llm = createLlm({ providers: [provider("bytedance", a, { extraBody: { thinking: { type: "disabled" } } })], timeouts: T });
    await llm.completeJson("chat", MSGS, opts);
    assert.deepEqual(a.calls.map((c) => "thinking" in c.params), [true, false]);
    await llm.completeJson("chat", MSGS, opts);
    assert.equal(a.calls.length, 3);
    assert.ok(!("thinking" in a.calls[2].params));
  });

  it("a 400 about response_format is retried without it and remembered", async () => {
    const a = fake((p) => { if (p.response_format) throw apiError(400, "response_format is not supported"); return completion(OK); });
    const llm = createLlm({ providers: [provider("bytedance", a)], timeouts: T });
    assert.equal((await llm.completeJson("judge", MSGS, opts)).raw, OK);
    await llm.completeJson("judge", MSGS, opts);
    assert.deepEqual(a.calls.map((c) => Boolean(c.params.response_format)), [true, false, false]);
  });

  it("jsonMode none sends no response_format; json_object sends it; maxTokens passes through", async () => {
    const a = fake(() => completion(OK));
    await createLlm({ providers: [provider("bytedance", a, { jsonMode: "none" })] }).completeJson("judge", MSGS, { temperature: 0, maxTokens: 99 });
    assert.ok(!("response_format" in a.calls[0].params));
    assert.equal(a.calls[0].params.max_tokens, 99);
    const b = fake(() => completion(OK));
    await createLlm({ providers: [provider("deepseek", b)] }).completeJson("judge", MSGS, opts);
    assert.deepEqual(b.calls[0].params.response_format, { type: "json_object" });
  });

  it("bad JSON twice on the primary falls back to the backup", async () => {
    const a = fake(() => completion("sorry, no json"));
    const b = fake(() => completion('Here: ```json\n{"x":1}\n```'));
    const r = await run(provider("bytedance", a), provider("deepseek", b)).completeJson("judge", MSGS, opts);
    assert.equal(a.calls.length, 2);
    assert.deepEqual([r.provider, r.raw], ["deepseek", '{"x":1}']);
  });

  it("bad JSON then good on the retry stays on the primary", async () => {
    const a = fake((_p, n) => completion(n === 1 ? "nope" : OK));
    const b = fake(() => completion(OK));
    const r = await run(provider("bytedance", a), provider("deepseek", b)).completeJson("judge", MSGS, opts);
    assert.equal(r.provider, "bytedance");
    assert.equal(b.calls.length, 0);
  });

  it("bad JSON on every provider returns the last raw", async () => {
    const a = fake(() => completion("first"));
    const b = fake(() => completion("last raw"));
    const r = await run(provider("bytedance", a), provider("deepseek", b)).completeJson("judge", MSGS, opts);
    assert.equal(r.raw, "last raw");
  });

  it("a truncated reply is returned as is", async () => {
    const a = fake(() => completion('{"a":', "length"));
    const r = await createLlm({ providers: [provider("deepseek", a)] }).completeJson("story", MSGS, { temperature: 1, maxTokens: 10 });
    assert.deepEqual([r.raw, r.truncated], ['{"a":', true]);
  });

  it("throws when every provider fails", async () => {
    const a = fake(() => { throw apiError(500); });
    const b = fake(() => { throw apiError(503); });
    await assert.rejects(run(provider("bytedance", a), provider("deepseek", b)).completeJson("chat", MSGS, opts), (e: any) => e.status === 503);
  });

  it("throws MissingApiKeyError with no providers", async () => {
    await assert.rejects(createLlm({ providers: [] }).completeJson("chat", MSGS, opts), /No model provider is configured/);
  });
});

describe("streamText fallback", () => {
  const two = (a: ChatClient, b: ChatClient, extra = {}) =>
    createLlm({ providers: [provider("bytedance", a), provider("deepseek", b)], timeouts: T, ...extra });

  it("streams from the primary and never sends response_format", async () => {
    const a = fake(() => chunks(["Hel", "lo"]));
    const b = fake(() => chunks(["x"]));
    assert.equal(await collect(two(a, b).streamText("chat", MSGS, opts)), "Hello");
    assert.equal(a.calls[0].params.stream, true);
    assert.ok(!("response_format" in a.calls[0].params));
    assert.equal(b.calls.length, 0);
  });

  it("error before the first token uses the backup stream", async () => {
    const a = fake(() => chunks([], apiError(503)));
    const b = fake(() => chunks(["backup"]));
    assert.equal(await collect(two(a, b).streamText("chat", MSGS, opts)), "backup");
  });

  it("an error when opening the stream (429) uses the backup", async () => {
    const a = fake(() => { throw apiError(429); });
    const b = fake(() => chunks(["backup"]));
    assert.equal(await collect(two(a, b).streamText("chat", MSGS, opts)), "backup");
  });

  it("error after the first token propagates and the backup is not called", async () => {
    const a = fake(() => chunks(["Hel"], apiError(500)));
    const b = fake(() => chunks(["x"]));
    const g = two(a, b).streamText("chat", MSGS, opts);
    const got: string[] = [];
    await assert.rejects(async () => { for await (const s of g) got.push(s); }, (e: any) => e.status === 500);
    assert.deepEqual(got, ["Hel"]);
    assert.equal(b.calls.length, 0);
  });

  it("no first token in time uses the backup", async () => {
    const a = fake(() => ({ [Symbol.asyncIterator]: () => ({ next: never }) }));
    const b = fake(() => chunks(["late but there"]));
    assert.equal(await collect(two(a, b).streamText("chat", MSGS, opts)), "late but there");
    assert.equal(a.calls[0].opts.signal.aborted, true);
  });

  it("a 400 about thinking is retried without it", async () => {
    const a = fake((p) => { if ("thinking" in p) throw apiError(400, "thinking not allowed"); return chunks(["ok"]); });
    const llm = createLlm({ providers: [provider("bytedance", a, { extraBody: { thinking: { type: "disabled" } } })], timeouts: T });
    assert.equal(await collect(llm.streamText("chat", MSGS, opts)), "ok");
    assert.equal(await collect(llm.streamText("chat", MSGS, opts)), "ok");
    assert.deepEqual(a.calls.map((c) => "thinking" in c.params), [true, false, false]);
  });

  it("an unrelated 400 throws without fallback", async () => {
    const a = fake(() => { throw apiError(400, "bad"); });
    const b = fake(() => chunks(["x"]));
    await assert.rejects(collect(two(a, b).streamText("chat", MSGS, opts)), /bad/);
    assert.equal(b.calls.length, 0);
  });
});

describe("circuit breaker", () => {
  it("skips the primary for 60 s after three failures, then tries it again", async () => {
    let clock = 1_000_000;
    const a = fake(() => { throw apiError(500); });
    const b = fake(() => completion(OK));
    const llm = createLlm({ providers: [provider("bytedance", a), provider("deepseek", b)], now: () => clock, timeouts: T });
    for (let i = 0; i < 3; i++) await llm.completeJson("chat", MSGS, opts);
    assert.equal(a.calls.length, 3);
    const r = await llm.completeJson("chat", MSGS, opts);
    assert.equal(a.calls.length, 3, "skipped");
    assert.deepEqual([r.provider, r.fallback], ["deepseek", true]);
    clock += 59_000;
    await llm.completeJson("chat", MSGS, opts);
    assert.equal(a.calls.length, 3);
    clock += 1_001;
    await llm.completeJson("chat", MSGS, opts);
    assert.equal(a.calls.length, 4, "tried again");
  });

  it("a success resets the failure count", async () => {
    let clock = 0;
    let fail = true;
    const a = fake(() => { if (fail) throw apiError(500); return completion(OK); });
    const b = fake(() => completion(OK));
    const llm = createLlm({ providers: [provider("bytedance", a), provider("deepseek", b)], now: () => clock });
    await llm.completeJson("chat", MSGS, opts);
    await llm.completeJson("chat", MSGS, opts);
    fail = false;
    await llm.completeJson("chat", MSGS, opts);
    fail = true;
    await llm.completeJson("chat", MSGS, opts);
    await llm.completeJson("chat", MSGS, opts);
    const before = a.calls.length;
    await llm.completeJson("chat", MSGS, opts);
    assert.equal(a.calls.length, before + 1, "only two failures since the success: not skipped");
  });

  it("a single provider is never skipped", async () => {
    const a = fake(() => { throw apiError(500); });
    const llm = createLlm({ providers: [provider("deepseek", a)], now: () => 0, timeouts: T });
    for (let i = 0; i < 5; i++) await assert.rejects(llm.completeJson("chat", MSGS, opts));
    assert.equal(a.calls.length, 5);
  });

  it("when every provider is skipped the primary is tried anyway", async () => {
    const a = fake(() => { throw apiError(500); });
    const b = fake(() => { throw apiError(500); });
    const llm = createLlm({ providers: [provider("bytedance", a), provider("deepseek", b)], now: () => 0, timeouts: T });
    for (let i = 0; i < 3; i++) await assert.rejects(llm.completeJson("chat", MSGS, opts));
    await assert.rejects(llm.completeJson("chat", MSGS, opts));
    assert.equal(a.calls.length, 4);
    assert.equal(b.calls.length, 3);
  });
});

describe("providersFromEnv", () => {
  const KEYS = ["ARK_API_KEY", "ARK_BASE_URL", "ARK_CHAT_MODEL", "ARK_STORY_MODEL", "ARK_JUDGE_MODEL", "ARK_THINKING", "ARK_JSON_MODE", "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "LLM_PRIMARY"];
  function withEnv<T>(env: Record<string, string>, fn: () => T): T {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, env);
    try { return fn(); } finally {
      for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
  }
  const names = (env: Record<string, string>) => withEnv(env, () => providersFromEnv().map((p) => p.name));

  it("orders by LLM_PRIMARY and drops unconfigured providers", () => {
    const both = { ARK_API_KEY: "k", ARK_CHAT_MODEL: "m", DEEPSEEK_API_KEY: "d" };
    assert.deepEqual(names(both), ["bytedance", "deepseek"]);
    assert.deepEqual(names({ ...both, LLM_PRIMARY: "deepseek" }), ["deepseek", "bytedance"]);
    assert.deepEqual(names({ DEEPSEEK_API_KEY: "d" }), ["deepseek"]);
    assert.deepEqual(names({ DEEPSEEK_API_KEY: "d", LLM_PRIMARY: "bytedance" }), ["deepseek"]);
    assert.deepEqual(names({ ARK_API_KEY: "k", ARK_CHAT_MODEL: "m" }), ["bytedance"]);
    assert.deepEqual(names({}), []);
  });

  it("a ByteDance key without a model id is not configured", () => {
    const warn = console.warn;
    console.warn = () => {};
    try { assert.deepEqual(names({ ARK_API_KEY: "k", DEEPSEEK_API_KEY: "d" }), ["deepseek"]); } finally { console.warn = warn; }
  });

  it("models, thinking and json mode come from env", () => {
    const [p] = withEnv({ ARK_API_KEY: "k", ARK_CHAT_MODEL: "chat-x", ARK_JUDGE_MODEL: "judge-x" }, providersFromEnv);
    assert.deepEqual([p.models.chat, p.models.judge, p.models.speakers, p.models.guide, p.models.story], ["chat-x", "judge-x", "judge-x", "judge-x", "chat-x"]);
    assert.deepEqual(p.extraBody, { thinking: { type: "disabled" } });
    assert.equal(p.jsonMode, "json_object");
    const [q] = withEnv({ ARK_API_KEY: "k", ARK_CHAT_MODEL: "c", ARK_THINKING: "omit", ARK_JSON_MODE: "none", ARK_STORY_MODEL: "s" }, providersFromEnv);
    assert.deepEqual(q.extraBody, {});
    assert.equal(q.jsonMode, "none");
    assert.equal(q.models.story, "s");
    const [d] = withEnv({ DEEPSEEK_API_KEY: "d" }, providersFromEnv);
    assert.equal(d.models.chat, "deepseek-chat");
  });
});

describe("against local fake providers (real SDK over HTTP on 127.0.0.1)", () => {
  function server(status: number, bodies: any[]): Promise<http.Server> {
    return new Promise((resolve) => {
      const s = http.createServer(async (req, res) => {
        let body = "";
        for await (const c of req) body += c;
        bodies.push(JSON.parse(body));
        if (status !== 200) {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "forced" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "x", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: OK } }] }));
      });
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
  }
  const url = (s: http.Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

  it("a wrong ARK key falls back to DeepSeek; thinking is sent only to ByteDance; omit removes it", async () => {
    const arkBodies: any[] = [];
    const dsBodies: any[] = [];
    const ark = await server(401, arkBodies);
    const ds = await server(200, dsBodies);
    const saved = { ...process.env };
    Object.assign(process.env, {
      ARK_API_KEY: "wrong", ARK_CHAT_MODEL: "ark-model", ARK_BASE_URL: url(ark),
      DEEPSEEK_API_KEY: "right", DEEPSEEK_BASE_URL: url(ds), DEEPSEEK_MODEL: "ds-model",
    });
    delete process.env.ARK_THINKING;
    try {
      const logs: LlmLog[] = [];
      const llm = createLlm({ providers: providersFromEnv(), log: (e) => logs.push(e) });
      const r = await llm.completeJson("judge", MSGS, opts);
      assert.deepEqual([r.provider, r.fallback, r.raw], ["deepseek", true, OK]);
      assert.deepEqual(arkBodies[0].thinking, { type: "disabled" });
      assert.deepEqual(arkBodies[0].response_format, { type: "json_object" });
      assert.equal(arkBodies[0].model, "ark-model");
      assert.ok(!("thinking" in dsBodies[0]));
      assert.equal(dsBodies[0].model, "ds-model");
      assert.deepEqual(logs.map((l) => [l.provider, l.ok, l.fallback]), [["bytedance", false, false], ["deepseek", true, true]]);

      process.env.ARK_THINKING = "omit";
      process.env.ARK_JSON_MODE = "none";
      arkBodies.length = 0;
      await createLlm({ providers: providersFromEnv() }).completeJson("judge", MSGS, opts);
      assert.ok(!("thinking" in arkBodies[0]));
      assert.ok(!("response_format" in arkBodies[0]));
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      ark.close();
      ds.close();
    }
  });
});
