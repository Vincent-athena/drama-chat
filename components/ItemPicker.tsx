"use client";

import type { PublicItem } from "@/lib/api-types";

/** A small menu above the composer: pick an owned item to show in the next message. */
export default function ItemPicker({
  items,
  onPick,
  onClose,
}: {
  items: PublicItem[];
  onPick: (item: PublicItem) => void;
  onClose: () => void;
}) {
  const owned = items.filter((i) => i.owned);
  return (
    <div className="mb-3 animate-rise rounded-xl border border-gold-500/30 bg-stage-900 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-gold-500">Show an item</p>
        <button type="button" onClick={onClose} className="text-xs text-white/50 hover:text-white">Close</button>
      </div>
      {owned.length === 0 ? (
        <p className="text-sm text-white/50">You are not carrying anything yet.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {owned.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onPick(item)}
                title={item.description}
                className="rounded-full border border-gold-500/40 bg-black/40 px-3 py-1 text-sm hover:border-gold-400"
              >
                {item.emoji} {item.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
