"use client";

import { AVATAR_EMOJIS } from "@/lib/profile";

export default function EmojiPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (emoji: string) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="Avatar" className="grid grid-cols-6 gap-2 sm:grid-cols-8 lg:grid-cols-12">
      {AVATAR_EMOJIS.map((e) => {
        const selected = e === value;
        return (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(e)}
            className={`flex h-11 items-center justify-center rounded-lg border text-2xl transition disabled:opacity-60 ${
              selected ? "border-gold-400 bg-gold-500/15" : "border-white/10 hover:border-gold-500/50"
            }`}
          >
            {e}
          </button>
        );
      })}
    </div>
  );
}
