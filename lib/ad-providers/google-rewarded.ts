/**
 * The Google Publisher Tag (GPT) rewarded flow as a small state machine with no React in it, so a test can
 * drive it with a fake `googletag`. Follows Google's "Display a rewarded ad" sample and Ad Manager help 9116812.
 */

const GPT_SRC = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
export const READY_TIMEOUT_MS = 10_000;
// "rewardedSlotClosed" may fire before or after "rewardedSlotGranted": wait a moment before calling it a cancel.
export const GRANT_GRACE_MS = 1_000;

type Timer = ReturnType<typeof setTimeout>;

export type GptSlot = object;
type GptEvent = { slot?: GptSlot; isEmpty?: boolean; makeRewardedVisible?(): boolean };
type Listener = (e: GptEvent) => void;
/** The small part of googletag this app uses. */
export type Googletag = {
  cmd: { push(fn: () => void): unknown };
  apiReady?: boolean;
  enums: { OutOfPageFormat: { REWARDED: unknown } };
  defineOutOfPageSlot(path: string, format: unknown): (GptSlot & { addService(s: unknown): GptSlot }) | null;
  pubads(): { addEventListener(t: string, l: Listener): unknown; removeEventListener(t: string, l: Listener): unknown };
  enableServices(): void;
  display(slot: GptSlot): void;
  destroySlots(slots?: GptSlot[]): boolean;
};
type GptWindow = { googletag?: Partial<Googletag> & { cmd?: Googletag["cmd"] } };

/** network: reward granted and the ad closed. cancel: closed without a reward. nofill: no ad could be shown. */
export type RewardedOutcome = "network" | "cancel" | "nofill";

const FAILED = "data-gpt-failed";

/**
 * Loads gpt.js once per page (reusing an existing window.googletag) and returns googletag. `onError` fires
 * if the script fails to load (an ad blocker, no network), for every caller: a later ad on the same page
 * after a blocked load hears it at once instead of waiting out the timeout.
 */
export function loadGpt(win: Window & GptWindow, onError: () => void): Googletag {
  const gt = (win.googletag = win.googletag ?? {}) as Googletag;
  gt.cmd = gt.cmd ?? [];
  let s = win.document.querySelector<HTMLScriptElement>(`script[src="${GPT_SRC}"]`);
  if (!s) {
    s = win.document.createElement("script");
    s.src = GPT_SRC;
    s.async = true;
    const el = s;
    el.addEventListener("error", () => el.setAttribute(FAILED, "1"));
    win.document.head.appendChild(s);
  }
  if (s.hasAttribute(FAILED)) win.setTimeout(() => onError(), 0);
  else s.addEventListener("error", () => onError());
  return gt;
}

/**
 * Starts one rewarded request. `settle` is called at most once. The returned function destroys the slot and
 * removes the listeners; call it on close and on unmount.
 */
export function playRewarded(
  gt: Googletag,
  adUnitPath: string,
  settle: (o: RewardedOutcome) => void,
  // Wrapped, not passed bare: a browser's setTimeout throws "Illegal invocation" when called as a method of
  // another object (Node's does not, so a test with the bare functions would pass and the page would crash).
  timers: { set(fn: () => void, ms: number): Timer; clear(t: Timer | undefined): void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (t) => clearTimeout(t),
  }
): { dispose(): void; fail(): void } {
  let slot: GptSlot | null = null;
  let granted = false;
  let done = false;
  let disposed = false;
  let wait: Timer | undefined;
  let grace: Timer | undefined;
  const listeners: [string, Listener][] = [];

  function dispose() {
    if (disposed) return;
    disposed = true;
    timers.clear(wait);
    timers.clear(grace);
    if (slot) {
      for (const [t, l] of listeners) gt.pubads().removeEventListener(t, l);
      gt.destroySlots([slot]);
    }
    slot = null;
  }
  function finish(o: RewardedOutcome) {
    if (done || disposed) return;
    done = true;
    dispose();
    settle(o);
  }
  const mine = (e: GptEvent) => !!slot && e.slot === slot;
  function on(type: string, fn: Listener) {
    const l: Listener = (e) => mine(e) && !disposed && fn(e);
    listeners.push([type, l]);
    gt.pubads().addEventListener(type, l);
  }

  // Nothing ready in time (blocked, slow, ineligible page) counts as no fill.
  wait = timers.set(() => finish("nofill"), READY_TIMEOUT_MS);
  gt.cmd.push(() => {
    if (disposed || done) return;
    const s = gt.defineOutOfPageSlot(adUnitPath, gt.enums.OutOfPageFormat.REWARDED);
    if (!s) return finish("nofill"); // the page is not eligible
    slot = s;
    s.addService(gt.pubads());
    // Clicking "Watch an ad" is the viewer's opt-in, so the ad is shown as soon as it is ready.
    on("rewardedSlotReady", (e) => {
      timers.clear(wait);
      // It returns whether the ad was displayed; false means nothing more will happen, so do not wait for it.
      if (e.makeRewardedVisible?.() === false) finish("nofill");
    });
    on("rewardedSlotGranted", () => {
      granted = true;
      if (grace) finish("network");
    });
    on("rewardedSlotClosed", () => {
      if (granted) return finish("network");
      grace = timers.set(() => finish("cancel"), GRANT_GRACE_MS);
    });
    on("slotRenderEnded", (e) => {
      if (e.isEmpty) finish("nofill");
    });
    gt.enableServices();
    gt.display(s);
  });
  return { dispose, fail: () => finish("nofill") };
}
