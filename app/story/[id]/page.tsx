"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import ApiKeyNotice from "@/components/ApiKeyNotice";
import CharacterCard from "@/components/CharacterCard";
import GroupChats from "@/components/GroupChats";
import PhaseBanner from "@/components/PhaseBanner";
import TicketInvalidNotice from "@/components/TicketInvalidNotice";
import type { PublicStory } from "@/lib/api-types";
import { ApiError } from "@/lib/client/api";
import { loadStoryView, restartStory } from "@/lib/client/story";
import { useRequireUser } from "@/lib/save/useSave";

export default function StoryHub({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { status, store } = useRequireUser();
  const [story, setStory] = useState<PublicStory | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);

  const load = useCallback(async () => {
    if (!store) return;
    try {
      const v = await loadStoryView(store, id);
      setStory(v.story);
      setHasApiKey(v.hasApiKey);
      setError(null);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Failed to load", code: e instanceof ApiError ? String(e.code) : "" });
    }
  }, [store, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function restart() {
    if (!store) return;
    await restartStory(store, id);
    await load();
  }

  async function reset() {
    if (!confirm("Restart this story? All chats and progress will be erased.")) return;
    try {
      await restart();
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Restart failed", code: "" });
    }
  }

  if (error?.code === "ticket_invalid") return <TicketInvalidNotice message={error.message} onRestart={restart} />;
  if (error) return <p className="text-blood-500">{error.message}</p>;
  if (status !== "ready" || !story) return <p className="text-white/50">Loading…</p>;

  const unlocked = story.characters.filter((c) => c.unlocked);
  const locked = story.characters.filter((c) => !c.unlocked);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <Link href="/" className="text-sm text-white/50 hover:text-white">← All stories</Link>
          <h1 className="mt-2 font-serif text-4xl text-gold-400">{story.title}</h1>
          <p className="mt-2 text-white/70">{story.synopsis}</p>
          <p className="mt-2 text-xs text-white/40">{story.setting}</p>
        </div>
        <button onClick={reset} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-white/60 hover:border-blood-500 hover:text-blood-500">
          ↺ Restart story
        </button>
      </div>

      {!hasApiKey && <ApiKeyNotice />}
      <PhaseBanner story={story} />

      {story.pastPhases.length > 0 && (
        <details className="rounded-xl border border-white/5 bg-stage-900/50 px-5 py-3 text-sm">
          <summary className="cursor-pointer text-white/60">Previously… ({story.pastPhases.length} chapter{story.pastPhases.length > 1 ? "s" : ""})</summary>
          <ol className="mt-3 space-y-3">
            {story.pastPhases.map((p, i) => (
              <li key={p.id}>
                <p className="font-serif text-gold-500">Chapter {i + 1}: {p.title}</p>
                <p className="italic text-white/60">{p.narration}</p>
              </li>
            ))}
          </ol>
        </details>
      )}

      <section>
        <h2 className="mb-4 font-serif text-2xl">The cast</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {unlocked.map((c) => <CharacterCard key={c.id} storyId={story.id} character={c} />)}
          {locked.map((c) => <CharacterCard key={c.id} storyId={story.id} character={c} />)}
        </div>
      </section>

      {store && <GroupChats key={`${story.id}-${story.phaseIndex}`} story={story} store={store} />}
    </div>
  );
}
