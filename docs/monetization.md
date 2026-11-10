# Monetization plan and the numbers to watch

## Stages
1. **Now: rewarded stand-in ads.** A player watches a labelled placeholder ad (15 s, server-timed) to unlock an
   `ad` story item or to buy one more story guide. One free guide per day; at most 10 completed ads per day,
   shared by both rewards. Nothing is charged and no network is involved; the point is to prove the loop and
   learn how often players want these rewards.
2. **Google rewarded ads (built, off until configured).** Set `AD_PROVIDER=google` and `GOOGLE_AD_UNIT_PATH` and
   sessions use Google's Publisher Tag (`lib/ad-providers/google.tsx`); without both, the stand-in plays exactly as
   before. The provider is stored in `ad_sessions.provider` and returned to the browser with the ad unit path.
   Nothing from Google loads unless a google session is being played.
   - **No fill policy** (`AD_NO_FILL`): `house` (default) plays the placeholder house ad when Google has no ad, the
     script is blocked or nothing is ready within 10 s; `deny` shows "No ad is available right now" and grants nothing.
   - **`ad_sessions.shown`** records what the browser says played: `network` or `house` (NULL if it said nothing).
     Stand-in sessions are always `house`. It exists for fill-rate numbers, not as proof.
   - **Server-side verification is not wired up yet.** Google offers optional server-side verification (SSV) for
     rewarded web: with an SSV URL set on the ad unit, Google's servers call it when a viewer completes the ad.
     Until that is built, the guards are the ones every provider gets: session owner, unused, the elapsed-time
     floor (`AD_MIN_SECONDS`, server clock) and the daily cap (`AD_DAILY_CAP`). Next step once real ads run:
     add a callback route, check what Google sends, and verify it in `googleVerifier` (`lib/ad-providers/types.ts`).
   - Public pages Google checks: `/privacy`, `/terms` (drafts for the owner to review), `/ads.txt` and the AdSense
     `google-adsense-account` meta tag, both driven by `GOOGLE_PUBLISHER_ID`.

   **Owner steps to turn Google ads on**
   1. Apply for AdSense with the live site (needs `/privacy` and `/terms`; put the real contact in `CONTACT_EMAIL`).
   2. Set `GOOGLE_PUBLISHER_ID` (`pub-` and digits). This enables `/ads.txt` and the meta tag; restart.
   3. Get an Ad Manager network and create a rewarded ad unit (turn off "Block non-instream video ads").
   4. Set `AD_PROVIDER=google` and `GOOGLE_AD_UNIT_PATH` (e.g. `/network-code/unit-name`).
   5. In the Google account, enable the "Privacy & messaging" consent message for EEA and UK visitors.
   6. Restart the app. Play one ad, then check the fill-rate query below.
3. **Later levers.** An ad for extra daily messages or hints, item packs, premium stories, an ad-free
   subscription, and cloud saves as a signed-in or paid benefit.

## Metrics to watch
The one that decides whether this pays: model cost per daily user (from the model-call log lines) against ad
revenue per daily user.

All come from `ad_sessions` (`started_at`, `completed_at` and `redeemed_at` are epoch milliseconds; shift to the
`DAY_TZ` day with `+ 7*3600*1000` for Asia/Ho_Chi_Minh).

Starts, completions and abandons per day:
```sql
SELECT date((started_at + 7*3600*1000) / 1000, 'unixepoch') AS day,
       COUNT(*)                                           AS starts,
       SUM(status = 'completed')                          AS completions,
       SUM(status = 'abandoned')                          AS abandons
FROM ad_sessions GROUP BY day ORDER BY day DESC;
```

Ad views per daily user (completed ads per user who watched at least one that day):
```sql
SELECT day, ROUND(1.0 * ads / users, 2) AS ads_per_user FROM (
  SELECT date((completed_at + 7*3600*1000) / 1000, 'unixepoch') AS day,
         COUNT(*) AS ads, COUNT(DISTINCT user_id) AS users
  FROM ad_sessions WHERE status = 'completed' GROUP BY day
) ORDER BY day DESC;
```

Unlock conversion (completed item sessions / item sessions started):
```sql
SELECT ROUND(1.0 * SUM(status = 'completed') / COUNT(*), 3) AS unlock_conversion,
       COUNT(*) AS item_sessions
FROM ad_sessions WHERE reward_type = 'item';
```

Also useful: unspent guide credits (`reward_type='guide' AND status='completed' AND redeemed_at IS NULL`), and users
who reach the daily cap (10 completions in one day).

Fill rate (share of completed google sessions that showed a real network ad; the browser's claim):
```sql
SELECT ROUND(1.0 * SUM(shown = 'network') / COUNT(*), 3) AS fill_rate, COUNT(*) AS completed
FROM ad_sessions WHERE provider = 'google' AND status = 'completed';
```

Completed ads per day by what was shown:
```sql
SELECT date((completed_at + 7*3600*1000) / 1000, 'unixepoch') AS day,
       COALESCE(shown, 'unknown') AS shown, COUNT(*) AS ads
FROM ad_sessions WHERE status = 'completed' GROUP BY day, shown ORDER BY day DESC, shown;
```
