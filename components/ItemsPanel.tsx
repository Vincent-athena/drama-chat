"use client";

import type { PublicItem, PublicStory } from "@/lib/api-types";
import type { SaveStore } from "@/lib/save/types";
import { UnlockItemButton } from "./AdUnlockModal";

/** What a player can do about an item they do not own yet (an ad item also gets a button). */
export function itemHowTo(item: PublicItem): string {
  if (item.source === "ad") return "🎬 Unlock with an ad";
  return "🔒 Find it by talking to the cast";
}

export function ItemCard({
  item,
  storyId,
  store,
  onUnlocked,
}: {
  item: PublicItem;
  storyId?: string;
  store?: SaveStore | null;
  onUnlocked?: () => void;
}) {
  return (
    <div className={`rounded-2xl border p-4 ${item.owned ? "border-gold-500/40 bg-stage-900/80" : "border-white/10 bg-black/30"}`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full bg-black/40 text-2xl ring-1 ${item.owned ? "ring-gold-500/40" : "opacity-60 ring-white/10"}`}>
          {item.emoji}
        </span>
        <h3 className="font-serif text-lg text-gold-400">{item.name}</h3>
      </div>
      {item.description && <p className="mt-3 text-sm text-white/70">{item.description}</p>}
      <p className={`mt-3 text-xs uppercase tracking-wider ${item.owned ? "text-gold-500" : "text-white/50"}`}>
        {item.owned ? "Owned" : item.source === "ad" && storyId && store ? "🎬 Ad unlock" : itemHowTo(item)}
      </p>
      {storyId && store && onUnlocked && (
        <UnlockItemButton item={item} storyId={storyId} store={store} onUnlocked={onUnlocked} className="mt-3" />
      )}
    </div>
  );
}

export default function ItemsPanel({ story, store, onChanged }: { story: PublicStory; store: SaveStore | null; onChanged: () => void }) {
  if (story.items.length === 0) return null;
  return (
    <section>
      <h2 className="mb-4 font-serif text-2xl">🎒 Items</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {story.items.map((item) => <ItemCard key={item.id} item={item} storyId={story.id} store={store} onUnlocked={onChanged} />)}
      </div>
    </section>
  );
}
