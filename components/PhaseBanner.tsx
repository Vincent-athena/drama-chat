"use client";

import { useState } from "react";
import type { PublicStory } from "@/lib/schema";

export default function PhaseBanner({ story }: { story: PublicStory }) {
  const [showHint, setShowHint] = useState(false);
  const phase = story.currentPhase;

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
      {phase.hint && (
        <div className="mt-3 text-sm">
          <button onClick={() => setShowHint((v) => !v)} className="text-gold-500 hover:text-gold-400">
            {showHint ? "Hide hint" : "Need a hint?"}
          </button>
          {showHint && <p className="mt-1 text-white/60">💡 {phase.hint}</p>}
        </div>
      )}
    </section>
  );
}
