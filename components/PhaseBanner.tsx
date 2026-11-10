"use client";

import { useCallback, useEffect, useState } from "react";
import type { GuideResponse, PublicStory } from "@/lib/api-types";
import { ApiError, apiFetch } from "@/lib/client/api";
import type { AdvanceGuide } from "@/lib/schema";
import { judgeContext } from "@/lib/save/context";
import type { SaveStore } from "@/lib/save/types";
import AdUnlockModal, { UnlockItemButton } from "./AdUnlockModal";
import { useMe } from "./MeProvider";

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default function PhaseBanner({ story, store, onChanged }: { story: PublicStory; store: SaveStore | null; onChanged: () => void }) {
  const [showHint, setShowHint] = useState(false);
  const [guide, setGuide] = useState<AdvanceGuide | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideError, setGuideError] = useState<string | null>(null);
  const [adOpen, setAdOpen] = useState(false);
  const [returnsAt, setReturnsAt] = useState<number | null>(null);
  const { me, refresh } = useMe();
  const phase = story.currentPhase;
  const quota = me?.guide ?? null;
  const canAsk = !quota || quota.freeLeftToday > 0 || quota.credits > 0;

  // The last guide of this chapter lives in the browser save; reopening it is free.
  useEffect(() => {
    let live = true;
    setGuide(null);
    setShowGuide(false);
    if (store) store.getGuide(story.id, story.phaseIndex).then((g) => live && setGuide(g)).catch(() => {});
    return () => {
      live = false;
    };
  }, [store, story.id, story.phaseIndex]);

  const fetchGuide = useCallback(async () => {
    if (!store) return;
    setShowGuide(true);
    setGuideLoading(true);
    setGuideError(null);
    try {
      const context = await judgeContext(store, story.id, story.phaseIndex);
      const res = await apiFetch(`/api/stories/${story.id}/guide`, { method: "POST", json: { context }, ticket: { store, storyId: story.id } });
      const d = (await res.json()) as GuideResponse;
      setGuide(d.guide);
      setReturnsAt(null);
      await store.setGuide(story.id, story.phaseIndex, d.guide);
    } catch (e) {
      if (e instanceof ApiError && e.code === "needs_ad") {
        setReturnsAt(typeof e.body.resetsAt === "number" ? e.body.resetsAt : null);
        setShowGuide(false);
      } else {
        setGuideError(e instanceof Error ? e.message : "Could not load the guide");
      }
    } finally {
      setGuideLoading(false);
      await refresh();
    }
  }, [store, story.id, story.phaseIndex, refresh]);

  /** Asks for a new guide: straight away when a free use or credit is left, otherwise after an ad. */
  function requestGuide() {
    if (canAsk) fetchGuide();
    else setAdOpen(true);
  }

  const askLabel = !quota
    ? "🧭 Advance guide"
    : quota.freeLeftToday > 0
      ? `🧭 Advance guide · ${quota.freeLeftToday} free today`
      : quota.credits > 0
        ? "🧭 Advance guide · 1 credit"
        : "🧭 Advance guide · watch an ad";
  const refreshCost = !quota || quota.freeLeftToday > 0 ? "uses 1 free guide" : quota.credits > 0 ? "uses 1 credit" : "needs an ad";

  if (!phase) {
    return (
      <section className="rounded-2xl border border-gold-500/40 bg-gradient-to-br from-stage-800 to-stage-900 p-6">
        <p className="text-xs uppercase tracking-[0.3em] text-gold-500">Finale</p>
        <h2 className="mt-1 font-serif text-3xl text-gold-400">The curtain falls</h2>
        <p className="mt-3 text-white/80">
          You have seen this drama through to the end. The characters are still here if you want to talk about what happened.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-gold-500/30 bg-gradient-to-br from-stage-800 to-stage-900 p-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-xs uppercase tracking-[0.3em] text-gold-500">
          Chapter {story.phaseIndex + 1} of {story.phaseCount}
        </p>
        <div className="flex gap-1">
          {Array.from({ length: story.phaseCount }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-6 rounded-full ${i < story.phaseIndex ? "bg-gold-500" : i === story.phaseIndex ? "bg-blood-500" : "bg-white/10"}`}
            />
          ))}
        </div>
      </div>
      <h2 className="mt-1 font-serif text-3xl text-gold-400">{phase.title}</h2>
      <p className="mt-3 font-serif italic leading-relaxed text-white/80">{phase.narration}</p>
      <div className="mt-4 rounded-lg bg-black/30 px-4 py-3">
        <p className="text-xs uppercase tracking-wider text-white/50">Objective</p>
        <p className="mt-0.5 text-white">{phase.objective}</p>
      </div>
      {phase.requiredItemIds.length > 0 && (
        <div className="mt-3 rounded-lg bg-black/30 px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-white/50">Required</p>
          <ul className="mt-1 space-y-1 text-sm">
            {phase.requiredItemIds.map((id) => {
              const item = story.items.find((i) => i.id === id);
              if (!item) return null;
              return (
                <li key={id} className={item.owned ? "text-gold-400" : "text-white/80"}>
                  {item.owned ? "✔" : "🔒"} {item.emoji} {item.name}
                  <span className="text-white/50"> — {item.owned ? "owned" : item.source === "ad" ? "unlock it with an ad" : "find it by talking to the cast"}</span>
                  <UnlockItemButton item={item} storyId={story.id} store={store} onUnlocked={onChanged} className="ml-3" />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {phase.hint && (
        <div className="mt-1 text-sm">
          <button onClick={() => setShowHint((v) => !v)} className="py-2 text-gold-500 hover:text-gold-400">
            {showHint ? "Hide hint" : "Need a hint?"}
          </button>
          {showHint && <p className="mt-1 text-white/60">💡 {phase.hint}</p>}
        </div>
      )}
      <div className="mt-1 text-sm">
        <button
          onClick={() => (showGuide ? setShowGuide(false) : guide ? setShowGuide(true) : requestGuide())}
          disabled={guideLoading || !store}
          className="py-2 text-left text-gold-500 hover:text-gold-400 disabled:opacity-50"
        >
          {showGuide ? "Hide advance guide" : guide ? "🧭 Show last guide" : askLabel}
        </button>
        {returnsAt && !canAsk && <p className="mt-1 text-xs text-white/50">Your free guide returns at {timeOf(returnsAt)}.</p>}
        {showGuide && (
          <div className="mt-2 rounded-lg border border-gold-500/20 bg-black/30 px-4 py-3">
            {guideLoading && <p className="text-white/50">The director is reading your story so far…</p>}
            {guideError && <p className="text-blood-500">{guideError}</p>}
            {guide && !guideLoading && (
              <>
                <p className="text-white/80">{guide.diagnosis}</p>
                <ol className="mt-3 list-decimal space-y-3 pl-5">
                  {guide.steps.map((s, i) => (
                    <li key={i} className="text-white/70">
                      {s.character && <span className="font-semibold text-gold-400">{s.character}: </span>}
                      {s.action}
                      {s.say && <p className="mt-1 border-l-2 border-gold-500/40 pl-3 italic text-white/60">“{s.say}”</p>}
                    </li>
                  ))}
                </ol>
                <button onClick={requestGuide} className="mt-3 text-xs text-white/40 hover:text-white/70">
                  ↻ Refresh after more chats ({refreshCost})
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {adOpen && store && (
        <AdUnlockModal
          reward={{ type: "guide" }}
          storyId={story.id}
          store={store}
          onClose={() => setAdOpen(false)}
          onDone={async () => {
            setAdOpen(false);
            await refresh();
            await fetchGuide();
          }}
        />
      )}
    </section>
  );
}
