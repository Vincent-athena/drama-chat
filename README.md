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

Other ways to set the key:

```bash
npm run setup -- sk-xxxxxxxxxxxxxxxx               # non-interactive
echo "DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxx" > .env.local
```

Get a key at https://platform.deepseek.com/api_keys. Restart `npm run dev` after changing it.

## Generate a mock story

```bash
npm run gen-story -- "a K-drama revenge plot inside a Seoul chaebol family"
npm run gen-story -- "mutiny on a generation ship" --phases 5 --characters 8
npm run gen-story                                   # random premise
```

Stories are saved to `stories/<id>.json`. You can also click **✨ Generate new story** in the app.
You can edit the JSON by hand (it is validated by `lib/schema.ts` on load).

## How it works

| Piece | File |
|---|---|
| Story format (zod) | `lib/schema.ts` |
| Character / director / generator prompts | `lib/prompts.ts` |
| DeepSeek calls (OpenAI-compatible SDK) | `lib/deepseek.ts` |
| Progress, chat history, story events (SQLite `data/drama.db`) | `lib/db.ts` |
| Unlock logic & public (secret-free) views | `lib/stories.ts` |
| Chat stream + director judgement | `app/api/stories/[id]/chat/[charId]/route.ts` |

- **Characters** only receive knowledge for chapters you've reached, so they can't spoil later twists.
  Their secrets are in the prompt, with the instruction to reveal them only when you earn it.
- **The director** runs after each reply. It returns JSON `{completed, reason, eventSummary}` checked
  against the chapter's hidden `completionCriteria`. When a chapter completes, its summary becomes a
  shared "what happened so far" memory for every character.
- A character locked until a later chapter is shown as `???` and its chat API returns 403.

Optional env vars: `DEEPSEEK_MODEL` (default `deepseek-chat`), `DEEPSEEK_BASE_URL` (default `https://api.deepseek.com`).
To restart a story, use **↺ Restart story** on the story page. To wipe everything, delete `data/`.
