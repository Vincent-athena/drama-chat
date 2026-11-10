# Monetization plan and the numbers to watch

## Stages
1. **Now: rewarded stand-in ads.** A player watches a labelled placeholder ad (15 s, server-timed) to unlock an
   `ad` story item or to buy one more story guide. One free guide per day; at most 10 completed ads per day,
   shared by both rewards. Nothing is charged and no network is involved; the point is to prove the loop and
   learn how often players want these rewards.
2. **Real network, once the site is live and approved.** Google rewarded web ads first (the app is a web app).
   Alternatives to compare when approval or fill rate is a problem: Unity LevelPlay, AppLovin MAX, AdinMo, Kiip.
   The seam is `lib/ad-providers/` (`AdProvider` in the browser, `AdServerVerifier` on the server): add a
   provider, send its completion evidence to `verifyCompletion`, keep the elapsed-time rule as a floor.
3. **Later levers.** Paid story packs or a no-ads pass, supporter tier with extra daily guides, cosmetic avatar
   emoji sets, seasonal stories, and a higher daily message cap for subscribers.

## Metrics to watch
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
