/**
 * Model providers with automatic fallback. The only file that creates an OpenAI client.
 * Providers are tried in order (ByteDance first by default, DeepSeek as the backup).
 * Never logs prompts, replies or keys.
 */
import OpenAI from "openai";
import {
  arkApiKey,
  arkBaseUrl,
  arkChatModel,
  arkJudgeModel,
  arkJsonMode,
  arkStoryModel,
  arkThinking,
  deepseekApiKey,
  deepseekBaseUrl,
  deepseekModel,
  llmPrimary,
} from "./env";
import { fixMismatchedBrackets } from "./json-repair";

export type LlmTask = "chat" | "speakers" | "judge" | "guide" | "story";
export type Msg = OpenAI.Chat.ChatCompletionMessageParam;
export type ChatClient = {
  chat: { completions: { create(params: any, opts?: { signal?: AbortSignal; timeout?: number }): Promise<any> } };
};
export type ProviderConfig = {
  name: "bytedance" | "deepseek";
  client: ChatClient;
  models: Record<LlmTask, string>;
  jsonMode: "json_object" | "none";
  extraBody: Record<string, unknown>;
};
export type LlmLog = { task: LlmTask; provider: string; model: string; ms: number; ok: boolean; fallback: boolean; error?: string };
export type Timeouts = {
  firstTokenMs: number; // chat, while another provider remains
  jsonMs: number;
  storyMs: number; // story stage, while another provider remains
  lastFirstTokenMs: number; // chat, when this is the last provider
  lastStoryMs: number; // story stage, when this is the last provider
  idleMs: number; // silence between tokens after the first one
};
export type JsonResult = { raw: string; truncated: boolean; provider: string; model: string; fallback: boolean };

export interface Llm {
  streamText(task: LlmTask, messages: Msg[], opts: { temperature: number }): AsyncGenerator<string>;
  completeJson(task: LlmTask, messages: Msg[], opts: { temperature: number; maxTokens?: number }): Promise<JsonResult>;
  configured(): string[];
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("No model provider is configured. Run `npm run setup` to add a ByteDance (ModelArk) or DeepSeek API key.");
  }
}

/** Our own timeout (no first token / no reply in time). */
export class LlmTimeoutError extends Error {
  constructor(ms: number) {
    super(`The model did not answer within ${ms} ms`);
    this.name = "AbortError";
  }
}

class ContentFilterError extends Error {
  constructor() {
    super("The reply was withheld by the provider's content filter");
    this.name = "ContentFilterError";
  }
}

const REFUSAL = /sensitive|moderation|content[_ ]?filter|risk|safety/i;
const CONNECTION_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

type ErrLike = { status?: unknown; code?: unknown; name?: unknown; message?: unknown };

/** Failures that mean "this provider is not usable right now": the backup should take over. */
export function isFallbackError(err: unknown): boolean {
  if (err instanceof LlmTimeoutError || err instanceof ContentFilterError) return true;
  if (err instanceof OpenAI.APIConnectionError) return true; // includes APIConnectionTimeoutError
  const e = (err ?? {}) as ErrLike;
  if (e.name === "AbortError" || e.name === "APIConnectionError" || e.name === "APIConnectionTimeoutError") return true;
  if (typeof e.code === "string" && CONNECTION_CODES.has(e.code)) return true;
  const status = typeof e.status === "number" ? e.status : undefined;
  if (status !== undefined) {
    if (status === 401 || status === 403 || status === 404 || status === 408 || status === 409 || status === 429 || status >= 500) return true;
    if (status === 400) {
      const msg = String(e.message ?? "");
      return (
        REFUSAL.test(msg) ||
        (/model|endpoint/i.test(msg) && /not ?found|not exist|does not exist|invalid/i.test(msg)) ||
        (typeof e.code === "string" && (REFUSAL.test(e.code) || /NotFound|InvalidEndpoint|ModelNotOpen/i.test(e.code)))
      );
    }
  }
  return false;
}

/** The first balanced `{...}` in `raw` (code fences and surrounding prose removed) as parseable JSON, or null. */
export function extractJson(raw: string): string | null {
  let text = raw;
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/.exec(text);
  if (fence && fence[1].includes("{")) text = fence[1];
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const candidate = fixMismatchedBrackets(text.slice(start, end + 1));
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

const DEFAULT_TIMEOUTS: Timeouts = { firstTokenMs: 15_000, jsonMs: 45_000, storyMs: 120_000, lastFirstTokenMs: 60_000, lastStoryMs: 290_000, idleMs: 60_000 };

function describeError(err: unknown): string {
  const e = (err ?? {}) as ErrLike;
  if (typeof e.status === "number") return `HTTP ${e.status}`;
  if (err instanceof LlmTimeoutError) return "timeout";
  return typeof e.name === "string" ? e.name : "error";
}

type Breaker = { fails: number; until: number };

export function createLlm(o: {
  providers: ProviderConfig[];
  now?: () => number;
  log?: (e: LlmLog) => void;
  timeouts?: Partial<Timeouts>;
  breaker?: { failures: number; skipMs: number };
}): Llm {
  const providers = o.providers;
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  const timeouts: Timeouts = { ...DEFAULT_TIMEOUTS, ...o.timeouts };
  const breakerCfg = o.breaker ?? { failures: 3, skipMs: 60_000 };
  const breakers = new Map<string, Breaker>(providers.map((p) => [p.name, { fails: 0, until: 0 }]));
  /** Per provider: request fields it rejected ("thinking", "response_format"); remembered for the process. */
  const unsupported = new Map<string, Set<string>>(providers.map((p) => [p.name, new Set()]));

  function usable(): ProviderConfig[] {
    if (providers.length === 0) throw new MissingApiKeyError();
    if (providers.length === 1) return providers;
    const t = now();
    const list = providers.filter((p) => breakers.get(p.name)!.until <= t);
    return list.length ? list : [providers[0]];
  }

  function failed(p: ProviderConfig) {
    const b = breakers.get(p.name)!;
    b.fails++;
    if (b.fails >= breakerCfg.failures) b.until = now() + breakerCfg.skipMs;
  }
  function succeeded(p: ProviderConfig) {
    const b = breakers.get(p.name)!;
    b.fails = 0;
    b.until = 0;
  }
  const emit = (p: ProviderConfig, task: LlmTask, started: number, ok: boolean, err?: unknown) =>
    log({
      task,
      provider: p.name,
      model: p.models[task],
      ms: Math.max(0, now() - started),
      ok,
      fallback: p !== providers[0],
      ...(err === undefined ? {} : { error: describeError(err) }),
    });

  function buildParams(p: ProviderConfig, task: LlmTask, base: Record<string, unknown>, json: boolean): any {
    const skip = unsupported.get(p.name)!;
    const params: Record<string, unknown> = { model: p.models[task], ...base };
    for (const [k, v] of Object.entries(p.extraBody)) if (!skip.has(k)) params[k] = v;
    if (json && p.jsonMode === "json_object" && !skip.has("response_format")) params.response_format = { type: "json_object" };
    return params;
  }

  /** Runs `attempt`, retrying without a request field the provider says it does not support. */
  async function tolerant<T>(p: ProviderConfig, task: LlmTask, base: Record<string, unknown>, json: boolean, attempt: (params: any) => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      const params = buildParams(p, task, base, json);
      try {
        return await attempt(params);
      } catch (err) {
        const e = err as ErrLike;
        if (e?.status === 400 && i < 2) {
          const msg = String(e.message ?? "");
          const skip = unsupported.get(p.name)!;
          const culprit = (["thinking", "response_format"] as const).find((k) => k in params && !skip.has(k) && msg.includes(k));
          if (culprit) {
            skip.add(culprit);
            continue;
          }
        }
        throw err;
      }
    }
  }

  async function jsonOnce(p: ProviderConfig, task: LlmTask, messages: Msg[], opts: { temperature: number; maxTokens?: number }, isLast: boolean) {
    const ms = task === "story" ? (isLast ? timeouts.lastStoryMs : timeouts.storyMs) : timeouts.jsonMs;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ac.abort();
        reject(new LlmTimeoutError(ms));
      }, ms);
    });
    deadline.catch(() => {});
    try {
      const base = { temperature: opts.temperature, messages, ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}) };
      const res = await tolerant(p, task, base, true, (params) =>
        Promise.race([p.client.chat.completions.create(params, { signal: ac.signal, timeout: ms }), deadline])
      );
      const choice = res?.choices?.[0];
      if (choice?.finish_reason === "content_filter") throw new ContentFilterError();
      return { raw: String(choice?.message?.content ?? ""), truncated: choice?.finish_reason === "length" };
    } finally {
      clearTimeout(timer);
    }
  }

  async function completeJson(task: LlmTask, messages: Msg[], opts: { temperature: number; maxTokens?: number }): Promise<JsonResult> {
    const list = usable();
    let lastBad: JsonResult | null = null;
    let lastError: unknown;
    for (const p of list) {
      let badJson = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const started = now();
        try {
          const r = await jsonOnce(p, task, messages, opts, p === list[list.length - 1]);
          const fallback = p !== providers[0];
          if (r.truncated) {
            succeeded(p);
            emit(p, task, started, true);
            return { ...r, provider: p.name, model: p.models[task], fallback };
          }
          const extracted = extractJson(r.raw);
          if (extracted !== null) {
            succeeded(p);
            emit(p, task, started, true);
            return { raw: extracted, truncated: false, provider: p.name, model: p.models[task], fallback };
          }
          badJson = true;
          lastBad = { raw: r.raw, truncated: false, provider: p.name, model: p.models[task], fallback };
          emit(p, task, started, false, new Error("unusable JSON"));
        } catch (err) {
          emit(p, task, started, false, err);
          if (!isFallbackError(err)) throw err;
          failed(p);
          lastError = err;
          badJson = false;
          break; // this provider is down: next one
        }
      }
      if (badJson) {
        failed(p);
        lastError = undefined;
      }
    }
    if (lastBad) return lastBad;
    throw lastError;
  }

  async function* streamText(task: LlmTask, messages: Msg[], opts: { temperature: number }): AsyncGenerator<string> {
    const list = usable();
    let lastError: unknown;
    for (let idx = 0; idx < list.length; idx++) {
      const p = list[idx];
      const started = now();
      const ac = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const firstMs = idx === list.length - 1 ? timeouts.lastFirstTokenMs : timeouts.firstTokenMs;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ac.abort();
          reject(new LlmTimeoutError(firstMs));
        }, firstMs);
      });
      deadline.catch(() => {});
      let iterator: AsyncIterator<any> | undefined;
      let first: string | null = null;
      try {
        const base = { temperature: opts.temperature, messages, stream: true };
        const stream = await tolerant(p, task, base, false, (params) =>
          Promise.race([p.client.chat.completions.create(params, { signal: ac.signal }), deadline])
        );
        const it: AsyncIterator<any> = stream[Symbol.asyncIterator]();
        iterator = it;
        for (;;) {
          const r: IteratorResult<any> = await Promise.race([it.next(), deadline]);
          if (r.done) break;
          const choice = r.value?.choices?.[0];
          const delta = choice?.delta?.content;
          if (delta) {
            first = delta;
            break;
          }
          if (choice?.finish_reason === "content_filter") throw new ContentFilterError();
        }
      } catch (err) {
        clearTimeout(timer);
        ac.abort();
        void iterator?.return?.()?.catch?.(() => {});
        emit(p, task, started, false, err);
        if (!isFallbackError(err)) throw err;
        failed(p);
        lastError = err;
        continue;
      }
      clearTimeout(timer);
      if (first === null) {
        // The stream ended without a token.
        if (idx < list.length - 1) {
          emit(p, task, started, false, new Error("empty reply"));
          failed(p);
          continue;
        }
        emit(p, task, started, true);
        succeeded(p);
        return;
      }
      const live = iterator!;
      // From here the player gets text: no more fallback, errors propagate unchanged.
      succeeded(p);
      emit(p, task, started, true);
      try {
        yield first;
        for (;;) {
          let idle: ReturnType<typeof setTimeout> | undefined;
          const silence = new Promise<never>((_, reject) => {
            idle = setTimeout(() => {
              ac.abort();
              reject(new LlmTimeoutError(timeouts.idleMs));
            }, timeouts.idleMs);
          });
          silence.catch(() => {});
          let r: IteratorResult<any>;
          try {
            r = await Promise.race([live.next(), silence]);
          } finally {
            clearTimeout(idle);
          }
          if (r.done) break;
          const d = r.value?.choices?.[0]?.delta?.content;
          if (d) yield d;
        }
      } catch (err) {
        failed(p);
        throw err;
      } finally {
        void iterator?.return?.()?.catch?.(() => {});
      }
      return;
    }
    throw lastError;
  }

  return { streamText, completeJson, configured: () => providers.map((p) => p.name) };
}

let warned = false;

/** Configured providers only, `LLM_PRIMARY` first. ByteDance needs a key and ARK_CHAT_MODEL. */
export function providersFromEnv(): ProviderConfig[] {
  const list: ProviderConfig[] = [];
  const mk = (apiKey: string, baseURL: string) => new OpenAI({ apiKey, baseURL, maxRetries: 0 });
  if (arkApiKey()) {
    const chat = arkChatModel();
    if (!chat) {
      if (!warned) {
        warned = true;
        console.warn("ARK_API_KEY is set but ARK_CHAT_MODEL is not: ByteDance is not configured.");
      }
    } else {
      const judge = arkJudgeModel();
      const thinking = arkThinking();
      list.push({
        name: "bytedance",
        client: mk(arkApiKey(), arkBaseUrl()),
        models: { chat, speakers: judge, judge, guide: judge, story: arkStoryModel() },
        jsonMode: arkJsonMode(),
        extraBody: thinking === "omit" ? {} : { thinking: { type: thinking } },
      });
    }
  }
  if (deepseekApiKey()) {
    const m = deepseekModel();
    list.push({
      name: "deepseek",
      client: mk(deepseekApiKey(), deepseekBaseUrl()),
      models: { chat: m, speakers: m, judge: m, guide: m, story: m },
      jsonMode: "json_object",
      extraBody: {},
    });
  }
  const primary = llmPrimary();
  return list.sort((a, b) => Number(b.name === primary) - Number(a.name === primary));
}

const ENV_KEYS = [
  "ARK_API_KEY", "ARK_BASE_URL", "ARK_CHAT_MODEL", "ARK_STORY_MODEL", "ARK_JUDGE_MODEL", "ARK_THINKING", "ARK_JSON_MODE",
  "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "LLM_PRIMARY",
];
let singleton: { sig: string; llm: Llm } | null = null;

/** The process-wide instance. Rebuilt (breaker state included) only when the provider env changes. */
export function llm(): Llm {
  const sig = ENV_KEYS.map((k) => process.env[k] ?? "").join("\u0001");
  if (!singleton || singleton.sig !== sig) {
    singleton = {
      sig,
      llm: createLlm({ providers: providersFromEnv(), log: (e) => console.info(JSON.stringify({ evt: "llm", ...e })) }),
    };
  }
  return singleton.llm;
}
