/**
 * Saves your model provider keys to .env.local and checks that they work. Also creates AUTH_SECRET there if it
 * is missing. Keys and secrets are never printed.
 *
 *   npm run setup                                   # prompts (input hidden); Enter skips a provider
 *   npm run setup -- sk-xxxxxxxx                    # non-interactive, DeepSeek key only
 *   npm run setup -- --ark <key> --ark-chat-model <id> [--ark-story-model <id>] [--ark-judge-model <id>]
 *                    [--ark-base-url <url>] [--deepseek <key>]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";

const ENV_FILE = path.join(process.cwd(), ".env.local");
const ARK_DEFAULT_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";

function makeRl(hidden: boolean) {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!(hidden && muted)) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  return {
    ask: (question: string) =>
      new Promise<string>((resolve) => {
        rl.question(question, (answer) => {
          rl.close();
          process.stdout.write("\n");
          resolve(answer.trim());
        });
        muted = true;
      }),
  };
}
const promptHidden = (q: string) => makeRl(true).ask(q);
const prompt = (q: string) => makeRl(false).ask(q);

function readLines(): string[] {
  return fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [];
}

function upsertEnv(key: string, value: string) {
  const kept = readLines().filter((l) => l.trim() && !l.startsWith(`${key}=`));
  kept.push(`${key}=${value}`);
  fs.writeFileSync(ENV_FILE, kept.join("\n") + "\n", { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
}

/** A value already in .env.local, used as the default so only the key has to be typed. */
function saved(key: string): string {
  const line = readLines().find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}

function ensureAuthSecret() {
  if (readLines().some((l) => /^AUTH_SECRET=.{32,}/.test(l.trim()))) return;
  upsertEnv("AUTH_SECRET", crypto.randomBytes(32).toString("base64url"));
  console.log("Created AUTH_SECRET in .env.local (not shown).");
}

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v.trim() : undefined;
}

/** GET {base}/models. Only 401 blocks saving. */
async function checkKey(label: string, base: string, key: string): Promise<void> {
  process.stdout.write(`Checking the ${label} key... `);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) {
      console.log(`rejected (401). The ${label} key is invalid; nothing was saved.`);
      process.exit(1);
    }
    console.log(res.ok ? "OK" : `got HTTP ${res.status}, saving anyway`);
  } catch (err) {
    console.log(`could not reach ${label} (${(err as Error).message}), saving anyway`);
  }
}

async function main() {
  ensureAuthSecret();
  const args = process.argv.slice(2);
  const legacyKey = args[0] && !args[0].startsWith("--") ? args[0].trim() : "";
  const nonInteractive = args.length > 0;

  let ark = flag("ark") ?? "";
  let arkBase = flag("ark-base-url") ?? "";
  let arkChat = flag("ark-chat-model") ?? "";
  let arkStory = flag("ark-story-model") ?? "";
  let arkJudge = flag("ark-judge-model") ?? "";
  let deepseek = flag("deepseek") ?? legacyKey;

  if (!nonInteractive) {
    ark = await promptHidden("ByteDance ModelArk API key (input hidden, Enter to skip): ");
    if (ark) {
      // Values already in .env.local are the defaults: Enter keeps them.
      const base0 = saved("ARK_BASE_URL") || ARK_DEFAULT_BASE;
      const chat0 = saved("ARK_CHAT_MODEL");
      arkBase = (await prompt(`Base URL [${base0}]: `)) || base0;
      const chatQuestion = chat0 ? `Chat model id [${chat0}]: ` : "Chat model id (required, from the ModelArk console): ";
      while (!arkChat) arkChat = (await prompt(chatQuestion)) || chat0;
      arkStory = await prompt(`Story model id [${saved("ARK_STORY_MODEL") || "same as chat"}]: `);
      arkJudge = await prompt(`Judge model id [${saved("ARK_JUDGE_MODEL") || "same as chat"}]: `);
    }
    deepseek = await promptHidden("DeepSeek API key (optional backup, input hidden, Enter to skip): ");
  }

  if (!ark && !deepseek) {
    console.error("No key given. Add a ByteDance ModelArk key or a DeepSeek key (https://platform.deepseek.com/api_keys).");
    process.exit(1);
  }
  if (ark && !arkChat) arkChat = saved("ARK_CHAT_MODEL");
  if (ark && !arkBase) arkBase = saved("ARK_BASE_URL");
  if (ark && !arkChat) {
    console.error("ByteDance needs a chat model id: pass --ark-chat-model <id>. Nothing was saved.");
    process.exit(1);
  }

  if (ark) await checkKey("ByteDance", arkBase || ARK_DEFAULT_BASE, ark);
  if (deepseek) await checkKey("DeepSeek", process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com", deepseek);

  if (ark) {
    upsertEnv("ARK_API_KEY", ark);
    if (arkBase && (arkBase !== ARK_DEFAULT_BASE || saved("ARK_BASE_URL"))) upsertEnv("ARK_BASE_URL", arkBase);
    upsertEnv("ARK_CHAT_MODEL", arkChat);
    if (arkStory) upsertEnv("ARK_STORY_MODEL", arkStory);
    if (arkJudge) upsertEnv("ARK_JUDGE_MODEL", arkJudge);
  }
  if (deepseek) upsertEnv("DEEPSEEK_API_KEY", deepseek);
  console.log(`Saved to ${ENV_FILE}. Restart \`npm run dev\` if it is running.`);
}

main();
