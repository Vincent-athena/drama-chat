"use client";

import Link from "next/link";
import { Fragment } from "react";
import type { DoneEvent, PublicItem } from "@/lib/api-types";

export type PhaseAdvance = {
  completedPhaseTitle: string;
  eventSummary?: string;
  finished: boolean;
  newPhase: { title: string; narration: string; objective: string } | null;
  unlocked: { id: string; name: string; avatarEmoji: string }[];
};

/** Renders *actions* in italics, everything else as plain text. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*[^*\n]+\*)/g).map((part, i) =>
        part.startsWith("*") && part.endsWith("*") && part.length > 2 ? (
          <em key={i} className="text-gold-400/80">{part.slice(1, -1)}</em>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

/** The `done` event of a turn, in the shape the chapter-complete modal shows. */
export function toPhaseAdvance(evt: DoneEvent): PhaseAdvance {
  return {
    completedPhaseTitle: evt.completedPhaseTitle ?? "",
    eventSummary: evt.eventSummary,
    finished: Boolean(evt.finished),
    newPhase: evt.newPhase ?? null,
    unlocked: evt.unlocked ?? [],
  };
}

export function PhaseAdvanceModal({
  storyId,
  advance,
  onClose,
}: {
  storyId: string;
  advance: PhaseAdvance;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
      <div className="w-full max-w-lg animate-rise rounded-2xl border border-gold-500/50 bg-stage-900 p-7 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-gold-500">Chapter complete</p>
        <h2 className="mt-1 font-serif text-2xl text-white/80 line-through decoration-gold-500/60">
          {advance.completedPhaseTitle}
        </h2>
        {advance.eventSummary && <p className="mt-3 italic text-white/70">{advance.eventSummary}</p>}
        {advance.newPhase ? (
          <>
            <h3 className="mt-6 font-serif text-3xl text-gold-400">{advance.newPhase.title}</h3>
            <p className="mt-2 font-serif italic text-white/80">{advance.newPhase.narration}</p>
            {advance.unlocked.length > 0 && (
              <div className="mt-5">
                <p className="text-xs uppercase tracking-wider text-white/50">New characters unlocked</p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  {advance.unlocked.map((c) => (
                    <Link
                      key={c.id}
                      href={`/story/${storyId}/chat/${c.id}`}
                      className="rounded-full border border-gold-500/40 bg-black/40 px-3 py-1 text-sm hover:border-gold-400"
                    >
                      {c.avatarEmoji} {c.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <h3 className="mt-6 font-serif text-3xl text-gold-400">The End</h3>
        )}
        <div className="mt-7 flex justify-center gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-white/60 hover:text-white">
            Keep talking
          </button>
          <Link href={`/story/${storyId}`} className="rounded-lg bg-blood-500 px-5 py-2 text-sm font-semibold hover:bg-blood-600">
            Back to the cast
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Gold card shown under the conversation when the director grants an item. */
export function ItemFoundNotice({ item }: { item: PublicItem }) {
  return (
    <div className="mx-auto max-w-md animate-rise rounded-xl border border-gold-500/50 bg-stage-900 px-4 py-3 text-center">
      <p className="text-sm text-gold-400">🎁 You found: {item.emoji} {item.name}</p>
      {item.description && <p className="mt-1 text-xs text-white/60">{item.description}</p>}
    </div>
  );
}

/** Shown when the director would close the chapter but a required item is missing. */
export function ItemBlockedNotice({ names }: { names: string[] }) {
  return (
    <p className="mx-auto max-w-md rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center text-sm text-white/70">
      The chapter cannot close yet: you still need {names.join(", ")}.
    </p>
  );
}

/** Notices for one finished turn: found items and the blocked-chapter message. */
export function toTurnNotices(evt: DoneEvent, items: PublicItem[]): { found: PublicItem[]; blocked: string[] } {
  const name = (id: string) => items.find((i) => i.id === id)?.name ?? id;
  return { found: evt.itemsFound, blocked: (evt.blockedByItemIds ?? []).map(name) };
}
