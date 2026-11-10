// Nightly SQLite backup. Runs inside the app container:
//   docker compose exec -T app node scripts/backup-db.mjs
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const KEEP_DAYS = 14;
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const backupDir = path.join(dataDir, "backups");
fs.mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().slice(0, 10);
const dest = path.join(backupDir, `drama-${stamp}.db`);
const db = new Database(path.join(dataDir, "drama.db"), { readonly: true, fileMustExist: true });
try {
  await db.backup(dest);
} finally {
  db.close();
}

let removed = 0;
const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
for (const f of fs.readdirSync(backupDir)) {
  if (!/^drama-\d{4}-\d{2}-\d{2}\.db$/.test(f)) continue;
  const p = path.join(backupDir, f);
  if (fs.statSync(p).mtimeMs < cutoff) {
    fs.rmSync(p);
    removed++;
  }
}
console.log(`${new Date().toISOString()} backup ok ${dest} (${fs.statSync(dest).size} bytes), removed ${removed} old`);
