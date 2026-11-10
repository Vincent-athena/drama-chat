/** Day boundaries in a fixed time zone. Isomorphic: Intl only. */
const DEFAULT_TZ = "Asia/Ho_Chi_Minh";

function defaultTz(): string {
  return (typeof process !== "undefined" && process.env?.DAY_TZ) || DEFAULT_TZ;
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

function partsOf(t: number, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(t))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { y: o.year, m: o.month, d: o.day, h: o.hour, mi: o.minute, s: o.second };
}

/** offset(t) = local wall clock as if UTC, minus t. */
function offset(t: number, tz: string): number {
  const p = partsOf(t, tz);
  const ms = Math.floor(t / 1000) * 1000;
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ms;
}

export function dayKey(now: number = Date.now(), tz: string = defaultTz()): string {
  const p = partsOf(now, tz);
  return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Epoch ms of the next local midnight. */
export function nextDayStart(now: number = Date.now(), tz: string = defaultTz()): number {
  const p = partsOf(now, tz);
  const guess = Date.UTC(p.y, p.m - 1, p.d + 1);
  let result = guess - offset(guess, tz);
  const again = guess - offset(result, tz);
  if (again !== result) result = again;
  return result;
}
