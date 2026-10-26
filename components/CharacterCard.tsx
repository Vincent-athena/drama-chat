import Link from "next/link";
import type { PublicCharacter } from "@/lib/schema";

export default function CharacterCard({ storyId, character }: { storyId: string; character: PublicCharacter }) {
  if (!character.unlocked) {
    return (
      <div className="relative rounded-xl border border-white/5 bg-stage-900/60 p-5 opacity-70 select-none">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center rounded-full bg-black/60 text-3xl grayscale blur-[1px]">
            👤
          </div>
          <div>
            <p className="font-serif text-lg text-white/40">???</p>
            <p className="text-xs text-white/40">🔒 Unlocks in: {character.unlockPhaseTitle}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Link
      href={`/story/${storyId}/chat/${character.id}`}
      className="group animate-rise rounded-xl border border-gold-500/20 bg-stage-800/70 p-5 transition hover:border-gold-400/60 hover:bg-stage-700/70"
    >
      <div className="flex items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-black/40 text-3xl ring-1 ring-gold-500/30 group-hover:ring-gold-400">
          {character.avatarEmoji}
        </div>
        <div className="min-w-0">
          <p className="font-serif text-lg text-gold-400">{character.name}</p>
          <p className="text-xs uppercase tracking-wider text-white/50">{character.role}</p>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-sm text-white/70">{character.personality}</p>
    </Link>
  );
}
