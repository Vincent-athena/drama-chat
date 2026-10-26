"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ApiKeyNotice from "@/components/ApiKeyNotice";
import GenerateStoryModal from "@/components/GenerateStoryModal";
import type { StorySummary } from "@/lib/schema";

export default function Library() {
  const [stories, setStories] = useState<StorySummary[] | null>(null);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);

  useEffect(() => {
    fetch("/api/stories")
      .then((r) => r.json())
      .then((d) => {
        setStories(d.stories);
        setHasApiKey(d.hasApiKey);
      });
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl text-gold-400">Choose your drama</h1>
          <p className="mt-2 text-white/60">Talk to the cast, uncover their secrets, and move the story forward.</p>
        </div>
        <button
          onClick={() => setShowGenerate(true)}
          disabled={!hasApiKey}
          className="rounded-lg bg-blood-500 px-5 py-2.5 text-sm font-semibold hover:bg-blood-600 disabled:opacity-50"
        >
          ✨ Generate new story
        </button>
      </div>

      {!hasApiKey && <ApiKeyNotice />}

      {stories === null ? (
        <p className="text-white/50">Loading…</p>
      ) : stories.length === 0 ? (
        <p className="text-white/50">No stories yet. Generate one!</p>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {stories.map((s) => (
            <Link
              key={s.id}
              href={`/story/${s.id}`}
              className="group animate-rise flex flex-col rounded-2xl border border-white/10 bg-stage-900/80 p-6 transition hover:border-gold-500/50"
            >
              <h2 className="font-serif text-2xl text-gold-400 group-hover:text-gold-500">{s.title}</h2>
              <p className="mt-2 line-clamp-4 flex-1 text-sm text-white/70">{s.synopsis}</p>
              <div className="mt-5">
                <div className="flex justify-between text-xs text-white/50">
                  <span>{s.characterCount} characters</span>
                  <span>{s.finished ? "Completed ✔" : s.phaseIndex === 0 ? "Not started" : `Chapter ${s.phaseIndex + 1} / ${s.phaseCount}`}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full bg-gold-500" style={{ width: `${(Math.min(s.phaseIndex, s.phaseCount) / s.phaseCount) * 100}%` }} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showGenerate && <GenerateStoryModal onClose={() => setShowGenerate(false)} />}
    </div>
  );
}
