"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AdReward, AdSessionView, PublicItem } from "@/lib/api-types";
import { adProviderFor } from "@/lib/ad-providers";
import { ApiError, apiFetch } from "@/lib/client/api";
import type { SaveStore } from "@/lib/save/types";

export type AdRewardRequest = { type: "item"; item: PublicItem } | { type: "guide" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code === "ad_cap" && typeof e.body.resetsAt === "number") {
    return `${e.message} More at ${new Date(e.body.resetsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

/**
 * Starts an ad session, plays the provider's ad, then asks the server to complete it. The server decides
 * whether the reward is granted. Closing early (or unmounting) abandons the session.
 */
export default function AdUnlockModal({
  reward,
  storyId,
  store,
  onDone,
  onClose,
}: {
  reward: AdRewardRequest;
  storyId: string;
  store: SaveStore;
  onDone(r: AdReward): void;
  onClose(): void;
}) {
  const [session, setSession] = useState<AdSessionView | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false); // strict mode runs the effect twice: start one session only
  const mounted = useRef(false);
  const sessionId = useRef<string | null>(null);
  const finished = useRef(false); // completed or abandoned: nothing left to abandon

  function abandon() {
    const id = sessionId.current;
    if (!id || finished.current) return;
    finished.current = true;
    apiFetch(`/api/ads/sessions/${id}/abandon`, { method: "POST", redirectOn401: false }).catch(() => {});
  }

  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      const body =
        reward.type === "item" ? { rewardType: "item", storyId, itemId: reward.item.id } : { rewardType: "guide", storyId };
      apiFetch("/api/ads/sessions", { method: "POST", json: body, ticket: { store, storyId } })
        .then(async (res) => {
          const s = ((await res.json()) as { session: AdSessionView }).session;
          sessionId.current = s.id;
          if (!mounted.current) return abandon();
          setSession(s);
        })
        .catch((e) => setError(errorText(e)));
    }
    return () => {
      mounted.current = false;
      // A strict-mode remount sets mounted again before this runs; a real unmount does not.
      setTimeout(() => {
        if (!mounted.current) abandon();
      }, 0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function complete() {
    const id = sessionId.current;
    if (!id) return;
    setClaiming(true);
    try {
      let res: Response;
      try {
        res = await apiFetch(`/api/ads/sessions/${id}/complete`, { method: "POST" });
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== "too_early") throw e;
        const wait = typeof e.body.retryAfter === "number" ? e.body.retryAfter : 1;
        await sleep(Math.min(wait, 30) * 1000);
        res = await apiFetch(`/api/ads/sessions/${id}/complete`, { method: "POST" });
      }
      finished.current = true;
      const { reward: granted } = (await res.json()) as { reward: AdReward };
      onDone(granted);
    } catch (e) {
      setClaiming(false);
      setError(errorText(e));
    }
  }

  function cancel() {
    abandon();
    onClose();
  }

  // Rendered on <body>: the chapter banner and item cards are animated (transformed) boxes, and a
  // fixed overlay inside one is positioned against that box instead of the screen.
  if (error) {
    return createPortal(
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
        <div className="w-full max-w-sm rounded-2xl border border-gold-500/30 bg-stage-900 p-6 text-center">
          <p className="text-blood-500">{error}</p>
          <button onClick={cancel} className="mt-4 rounded-lg border border-white/20 px-4 py-1.5 text-sm text-white/80 hover:text-white">
            Close
          </button>
        </div>
      </div>,
      document.body
    );
  }
  if (!session || claiming) {
    return createPortal(
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
        <p className="font-serif italic text-white/70">{claiming ? "Confirming your reward…" : "Getting an ad ready…"}</p>
      </div>,
      document.body
    );
  }
  const { Component } = adProviderFor(session.provider);
  return createPortal(<Component minSeconds={session.minSeconds} onFinished={complete} onCancel={cancel} />, document.body);
}

/** The "🎬 Watch an ad to unlock" button for an unowned ad item, with its modal. */
export function UnlockItemButton({
  item,
  storyId,
  store,
  onUnlocked,
  className = "",
}: {
  item: PublicItem;
  storyId: string;
  store: SaveStore | null;
  onUnlocked(): void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (item.owned || item.source !== "ad" || !store) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`rounded-lg border border-gold-500/40 px-3 py-1.5 text-xs text-gold-400 hover:bg-gold-500/10 ${className}`}
      >
        🎬 Watch an ad to unlock
      </button>
      {open && (
        <AdUnlockModal
          reward={{ type: "item", item }}
          storyId={storyId}
          store={store}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onUnlocked();
          }}
        />
      )}
    </>
  );
}
