# 🎭 Drama Chat

Interactive drama chat. Pick a story, talk one-on-one with its characters, and uncover the plot.
Each story has chapters (phases). An AI "director" watches your conversations, and when you
reach a chapter's objective the story advances and **new characters unlock**.
DeepSeek plays every character and also writes new stories.

## Quick start

```bash
npm install
npm run setup          # paste your DeepSeek API key (hidden input), saved to .env.local
npm run dev            # open http://localhost:3000
```

`npm run setup` also creates `AUTH_SECRET` in `.env.local` (a random value, never printed).

Other ways to set the key:

```bash
npm run setup -- sk-xxxxxxxxxxxxxxxx               # non-interactive
echo "DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx" > .env.local
```

Get a key at https://platform.deepseek.com/api_keys. Restart `npm run dev` after changing it.

## Accounts and saves

You sign in with your email: the app sends a 6-digit code (valid 10 minutes), no password. A new email
creates an account automatically.

- **Development**: with no `RESEND_API_KEY`, the code is printed in the server log as
  `[dev mail] code for <email>: 123456`. In production, with no key, sign-in answers 503 and no code is logged.
- **Your save lives in your browser** (IndexedDB, one database per account: chats, group chats, director
  notes, story events and progress). The server keeps only accounts and rate-limit counters, never chat text.
  Each request carries the relevant slice of your chat. Progress is proven by a signed *save ticket*
  (`x-save-ticket` header) that the server issues and verifies, so edited browser data cannot unlock characters.
- Clearing site data or using another browser starts you over. Rotating `AUTH_SECRET` signs everyone out and
  restarts story progress (chats survive).
- **Admins** (`ADMIN_EMAILS`, comma separated; empty means nobody) see **✨ Generate new story**. Generated
  stories are saved under `$DATA_DIR/stories/` (default `data/stories/`); the bundled `stories/` folder is read-only.
- Env: `AUTH_SECRET` (required, 32+ chars), `ADMIN_EMAILS`, `APP_ORIGIN`, `DATA_DIR`, `RESEND_API_KEY`, `MAIL_FROM`,
  `DAILY_MESSAGE_CAP` (default 200 chat turns per account per day), `DAY_TZ` (default `Asia/Ho_Chi_Minh`). See `.env.example`.

## Generate a mock story

```bash
npm run gen-story -- "a K-drama revenge plot inside a Seoul chaebol family"
npm run gen-story -- "mutiny on a generation ship" --phases 5 --characters 8
npm run gen-story                                   # random premise
```

Stories are saved to `data/stories/<id>.json` (or `$DATA_DIR/stories/`). Admins can also click
**✨ Generate new story** in the app. To ship a story with the app, move its JSON into `stories/`.
You can edit the JSON by hand (it is validated by `lib/schema.ts` on load).

## Group chats

On a story page, **＋ New group chat** puts two or more unlocked characters in one room.
After each of your messages, the director picks who answers (1-3 characters, anyone you address by name first),
and each character replies in turn in its own voice.

Context flows both ways:
- In a group, each character remembers its own private chat with you. The others don't hear it.
- In a private chat, a character remembers what was said in the groups it was part of.

The director sees group messages too, so a chapter can be completed in a group, for example by
confronting two suspects at once.

## Deploy to Snow

Production runs as two containers on Snow (a Linux x86_64 machine with Docker, no Node): the app (Next
standalone, `node server.js`) and a `cloudflared` sidecar. The app publishes no host port; the tunnel is the
only way in. Use `node server.js` in production, not `next start` (it warns with `output: "standalone"`).

First-time setup on Snow:

```bash
git clone <your-repo-url> ~/drama-chat && cd ~/drama-chat
cp .env.example .env && chmod 600 .env     # then fill it in, see below
mkdir -p data/backups
```

Keys to fill in `.env`: `AUTH_SECRET` (`openssl rand -base64 32`), `APP_ORIGIN` (the public https origin),
`ADMIN_EMAILS`, `RESEND_API_KEY`, `MAIL_FROM`, `ARK_API_KEY` / `ARK_CHAT_MODEL` / `ARK_BASE_URL`,
`DEEPSEEK_API_KEY`, `TUNNEL_TOKEN`. The container user must own `data/`: if your user on Snow is not
uid 1000, run `chown 1000:1000 data` or set `APP_UID` / `APP_GID` in `.env` to your ids (`id -u`, `id -g`).
`cloudflared` is pinned to release `2026.10.7` in `docker-compose.yml`; bump it deliberately.

Manual steps (only you can do these, they need your accounts):

1. **Only you:** add the zone to Cloudflare, copy the existing DNS records across first, then change the
   nameservers at Spaceship to the ones Cloudflare shows.
2. **Only you:** in Cloudflare Zero Trust create a tunnel, copy its token into `TUNNEL_TOKEN` in Snow's `.env`,
   and add the public hostname `dramachat.ezai.tech` with service `http://app:3000`.
3. **Only you:** in Resend verify the sending domain and create an API key for `RESEND_API_KEY`.
4. Fill `.env` as above, then from your machine run `scripts/deploy.sh` (or `scripts/deploy.sh <branch>`). It
   pulls on Snow, runs `docker compose up -d --build`, and waits up to 60 s for `/api/health`.
5. Add the nightly backup to Snow's crontab (keeps 14 days in `data/backups/`):

```
15 3 * * * cd ~/drama-chat && docker compose exec -T app node scripts/backup-db.mjs >> data/backups/backup.log 2>&1
```

Roll back: on Snow, `git checkout <previous sha> && docker compose up -d --build`. The database and generated
stories live in `./data` and survive rebuilds.

## How it works

| Piece | File |
|---|---|
| Story format (zod) | `lib/schema.ts` |
| Character / director / generator prompts | `lib/prompts.ts` |
| DeepSeek calls (OpenAI-compatible SDK) | `lib/llm.ts` |
| Accounts, sessions, login codes (SQLite `data/drama.db`) | `lib/db.ts`, `lib/auth.ts` |
| Signed save ticket | `lib/ticket.ts`, `lib/ticket-payload.ts` |
| The browser save (IndexedDB) | `lib/save/` |
| Unlock logic & public (secret-free) views | `lib/stories.ts` |
| Chat stream | `app/api/stories/[id]/chat/[charId]/route.ts` |
| Group chat stream | `app/api/stories/[id]/group-chat/route.ts` |
| Director judgement & chapter advance (stateless) | `lib/director.ts` |

- **Characters** only receive knowledge for chapters you've reached, so they can't spoil later twists.
  Their secrets are in the prompt, with the instruction to reveal them only when you earn it.
- **The director** runs after each reply. It returns JSON `{completed, reason, eventSummary, notes}` checked
  against the chapter's hidden `completionCriteria`. It reads the last 30 messages plus its own running notes
  on what you've achieved this chapter, so progress made long ago (or in another chat) still counts. When a chapter completes, its summary becomes a
  shared "what happened so far" memory for every character.
- A character locked until a later chapter (by the signed ticket) is shown as `???` and its chat API returns 403.

Optional env vars: `DEEPSEEK_MODEL` (default `deepseek-chat`), `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`).
To restart a story, use **↺ Restart story** on the story page. To wipe the accounts, delete `data/`
(browser saves stay in the browsers; clear site data to remove them).
