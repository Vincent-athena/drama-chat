# 🎭 Drama Chat

Interactive drama chat. Pick a story, talk one-on-one with its characters, and uncover the plot.
Each story has chapters (phases). An AI "director" watches your conversations, and when you
reach a chapter's objective the story advances and **new characters unlock**.
ByteDance (ModelArk) plays every character and writes new stories, with DeepSeek as the backup.

## Quick start

```bash
npm install
npm run setup          # paste your model provider key(s) (hidden input), saved to .env.local
npm run dev            # open http://localhost:3000
```

`npm run setup` also creates `AUTH_SECRET` in `.env.local` (a random value, never printed).

Other ways to set the key:

```bash
npm run setup -- sk-xxxxxxxxxxxxxxxx               # non-interactive, DeepSeek key only
npm run setup -- --ark <key> --ark-chat-model <model-id> --deepseek <key>   # ByteDance primary, DeepSeek backup
echo "DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx" >> .env.local
```

Get a DeepSeek key at https://platform.deepseek.com/api_keys. Restart `npm run dev` after changing keys.

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

## Items, ads and the story guide

Each story has 4 to 7 items. **Start** items are yours from the first chapter, **found** items are handed over by a
character when the director sees the condition met in your chats, and **ad** items are unlocked by watching an ad.
A chapter can list `requiredItems` you must carry before it can end. In a private or group chat, the **show item**
button opens a picker so you can put an item you own in front of a character. Ad items survive **↺ Restart story**;
found items do not.

The **story guide** (on the chapter banner) is one free per day, then one per ad watched. Env (see `.env.example`):
`GUIDE_FREE_PER_DAY` (default 1), `AD_MIN_SECONDS` (default 15, the server times it), `AD_DAILY_CAP` (default 10
completed ads per account per day, shared by item and guide rewards). By default the ad is a labelled placeholder
with no network. Google rewarded ads switch on with env only, no code change: `AD_PROVIDER=google` plus
`GOOGLE_AD_UNIT_PATH` (the ad unit), optionally `GOOGLE_PUBLISHER_ID` (`pub-…`, serves `/ads.txt` and the AdSense
meta tag), `AD_NO_FILL=house|deny` (what to show when Google has no ad) and `CONTACT_EMAIL` (shown on the legal
pages). Public pages: `/privacy`, `/terms`, `/ads.txt`. Owner steps and metrics: `docs/monetization.md`.

## Profile

The profile page (user menu) lets you change your display name and avatar emoji, see your signed-in devices and
**sign out everywhere**, **export** the browser save to a JSON file and **import** it on another browser, and
**delete your account** (type your email to confirm). Deleting removes the account on the server; the save stays in
the browser until you clear site data.

## Checks

```bash
npm run typecheck          # tsc --noEmit
npm test                   # node:test suite
npm run validate-stories   # every file in stories/ against the schema and the item rules
```

A hand-written story must pass the item rules in `lib/story-checks.ts`: 4 to 7 items with at least one start, found
and ad item; some chapter has `requiredItems`; the first chapter and non-fixture chapters never require an ad item; and
a found item is named in the secrets or knowledge of a character unlocked by the first chapter that requires it, and an
ad item is named in some character's `knowledgeByPhase`. Found items need an `obtainCriteria` naming the giver.

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

Keys to uncomment and fill in `.env` (the provider lines in `.env.example` are commented out): `AUTH_SECRET` (`openssl rand -base64 32`), `APP_ORIGIN` (the public https origin),
`ADMIN_EMAILS`, `RESEND_API_KEY`, `MAIL_FROM`, `ARK_API_KEY` / `ARK_CHAT_MODEL` / `ARK_BASE_URL`,
`DEEPSEEK_API_KEY`, `TUNNEL_TOKEN`. The container user must own `data/`: if your user on Snow is not
uid 1000, run `chown 1000:1000 data` or set `APP_UID` / `APP_GID` in `.env` to your ids (`id -u`, `id -g`).
`cloudflared` is pinned to release `2026.10.7` in `docker-compose.yml`; bump it deliberately.

Manual steps (only you can do these, they need your accounts):

1. **Only you:** add the zone to Cloudflare, copy the existing DNS records across first, then change the
   nameservers at Spaceship to the ones Cloudflare shows.
2. **Only you:** in Cloudflare Zero Trust create a tunnel, copy its token into `TUNNEL_TOKEN` in Snow's `.env`,
   and add your public hostname (for example `chat.example.com`) with service `http://app:3000`.
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
| Model calls for the app (character, director, guide, story generation) | `lib/llm.ts` |
| Model providers, fallback and logging (OpenAI-compatible SDK) | `lib/llm-core.ts` |
| Accounts, sessions, login codes (SQLite `data/drama.db`) | `lib/db.ts`, `lib/auth.ts` |
| Signed save ticket | `lib/ticket.ts`, `lib/ticket-payload.ts` |
| The browser save (IndexedDB) | `lib/save/` |
| Unlock logic & public (secret-free) views | `lib/stories.ts` |
| Chat stream | `app/api/stories/[id]/chat/[charId]/route.ts` |
| Group chat stream | `app/api/stories/[id]/group-chat/route.ts` |
| Director judgement & chapter advance (stateless) | `lib/director.ts` |
| Items: owned, found and ad items, chapter requirements | `lib/items.ts` |
| Rewarded ads (placeholder) | `lib/ads.ts` |
| Story guide and its daily allowance | `lib/guide.ts` |
| Content rules for hand-written stories | `lib/story-checks.ts` |

- **Characters** only receive knowledge for chapters you've reached, so they can't spoil later twists.
  Their secrets are in the prompt, with the instruction to reveal them only when you earn it.
- **The director** runs after each reply. It returns JSON `{completed, reason, eventSummary, notes, grantedItemIds}` checked
  against the chapter's hidden `completionCriteria`. It reads the last 30 messages plus its own running notes
  on what you've achieved this chapter, so progress made long ago (or in another chat) still counts. When a chapter completes, its summary becomes a
  shared "what happened so far" memory for every character.
- A character locked until a later chapter (by the signed ticket) is shown as `???` and its chat API returns 403.

## Model providers

Every model call (character chat, group chat, speaker picker, director, story guide, story generation) goes
through an ordered provider list: ByteDance (BytePlus ModelArk, OpenAI-compatible) first, DeepSeek as the backup.
Only configured providers are used; with only a DeepSeek key the app runs on DeepSeek alone.

| Variable | Default | Notes |
|---|---|---|
| `ARK_API_KEY` | unset | ByteDance is configured only when this **and** `ARK_CHAT_MODEL` are set |
| `ARK_CHAT_MODEL` | unset | model id from the ModelArk console (character chat) |
| `ARK_STORY_MODEL` | `ARK_CHAT_MODEL` | story generation |
| `ARK_JUDGE_MODEL` | `ARK_CHAT_MODEL` | director, speaker picker, story guide |
| `ARK_BASE_URL` | `https://ark.ap-southeast.bytepluses.com/api/v3` | China console (Volcano Engine Ark): set its base URL |
| `ARK_THINKING` | `disabled` | `disabled`, `enabled`, `auto`, or `omit` (send no `thinking` field) |
| `ARK_JSON_MODE` | `json_object` | `none` sends no `response_format` |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL` | unset / `deepseek-chat` / `https://api.deepseek.com` | backup |
| `LLM_PRIMARY` | `bytedance` | `bytedance` or `deepseek` |

**Fallback.** The backup takes over on a network error, a timeout (no first token within 15 s for chat; 45 s for
a JSON call; 120 s for a story generation call; these short limits apply only while another provider remains: the
last provider gets 60 s for the first token and 290 s for a story call), a wrong model id (HTTP 404, or a 400 saying
the model or endpoint does not exist), HTTP 401/403/408/409/429/5xx, a content-moderation refusal, or
JSON that is still unusable after one retry. A chat stream falls back only before the first token reached the
player; after that the failure is reported as "The reply was interrupted" (this includes 60 s of silence between tokens). After three consecutive failures
the primary is skipped for 60 s, then tried again. If a provider rejects the `thinking` or `response_format`
field (HTTP 400 naming it), the call is retried without it and remembered until restart. JSON replies are
tolerantly parsed (code fences and surrounding prose are stripped).

**Reading the log.** Each attempt prints one line, for example
`{"evt":"llm","task":"chat","provider":"deepseek","model":"deepseek-chat","ms":812,"ok":true,"fallback":true}`.
`fallback:true` means the backup answered; `ok:false` lines carry a short `error` (HTTP status or error name).
`ms` is the time to the first token for streams. Prompts, replies and keys are never logged.

**Quality check before making ByteDance the default.** Play the same five turns (Vietnamese and English) on
`sample-midnight-manor` and `sai-gon-2077`, plus one 8-chapter generation, first with `LLM_PRIMARY=bytedance`
and then with `LLM_PRIMARY=deepseek`. Compare voice, first-token latency (`ms` in the log) and JSON validity,
and record the results in the PR description.

Story generation streams progress (`POST /api/stories/generate` answers with NDJSON: `progress`, `ping`,
then `done` or `error`) so a generation longer than 100 s is not cut off by Cloudflare.
To restart a story, use **↺ Restart story** on the story page. To wipe the accounts, delete `data/`
(browser saves stay in the browsers; clear site data to remove them).
