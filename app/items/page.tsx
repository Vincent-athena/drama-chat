"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ItemCard } from "@/components/ItemsPanel";
import type { OwnedStoryItems } from "@/lib/api-types";
import { describeApiError } from "@/lib/client/api";
import { loadOwnedItems } from "@/lib/client/items";
import { useRequireUser } from "@/lib/save/useSave";

export default function ItemsPage() {
  const { status, store } = useRequireUser();
  const [stories, setStories] = useState<OwnedStoryItems[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!store) return;
    let live = true;
    loadOwnedItems(store)
      .then((s) => live && setStories(s))
      .catch((e) => live && setError(describeApiError(e)));
    return () => { live = false; };
  }, [store]);

  if (status !== "ready") return <p className="text-white/50">{status === "guest" ? "Redirecting to sign in…" : "Loading…"}</p>;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="text-sm text-white/50 hover:text-white">← All stories</Link>
        <h1 className="mt-2 font-serif text-4xl text-gold-400">🎒 My items</h1>
        <p className="mt-2 text-white/70">Everything you carry, by story.</p>
      </div>
      {error && <p className="text-blood-500">{error}</p>}
      {!stories && !error && <p className="text-white/50">Loading…</p>}
      {stories && stories.length === 0 && (
        <p className="font-serif italic text-white/50">You are not carrying anything yet. Start a story to get going.</p>
      )}
      {stories?.map((s) => (
        <section key={s.storyId}>
          <h2 className="mb-4 font-serif text-2xl">
            <Link href={`/story/${s.storyId}`} className="hover:text-gold-400">{s.title}</Link>
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {s.items.map((item) => <ItemCard key={item.id} item={item} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
