/**
 * Saves your DeepSeek API key to .env.local and checks that it works.
 *
 *   npm run setup                 # prompts for the key (input hidden)
 *   npm run setup -- sk-xxxxxxxx  # non-interactive
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";

const ENV_FILE = path.join(process.cwd(), ".env.local");

function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer.trim());
    });
    muted = true;
  });
}

function upsertEnv(key: string, value: string) {
  const lines = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/) : [];
  const kept = lines.filter((l) => l.trim() && !l.startsWith(`${key}=`));
  kept.push(`${key}=${value}`);
  fs.writeFileSync(ENV_FILE, kept.join("\n") + "\n", { mode: 0o600 });
}

async function main() {
  const key = process.argv[2]?.trim() || (await promptHidden("Paste your DeepSeek API key (input hidden): "));
  if (!key) {
    console.error("No key entered. Get one at https://platform.deepseek.com/api_keys");
    process.exit(1);
  }

  const baseURL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
  process.stdout.write("Checking key with DeepSeek... ");
  try {
    const res = await fetch(`${baseURL}/models`, { headers: { Authorization: `Bearer ${key}` } });
    if (res.status === 401) {
      console.log("rejected (401). The key is invalid; nothing was saved.");
      process.exit(1);
    }
    console.log(res.ok ? "OK" : `got HTTP ${res.status}, saving anyway`);
  } catch (err) {
    console.log(`could not reach DeepSeek (${(err as Error).message}), saving anyway`);
  }

  upsertEnv("DEEPSEEK_API_KEY", key);
  console.log(`Saved to ${ENV_FILE}. Restart \`npm run dev\` if it is running.`);
}

main();
