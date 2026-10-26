"use client";

import Link from "next/link";
import { Fragment } from "react";

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

/** Reads an NDJSON chat stream, calling `onEvent` for each line. Throws on HTTP errors. */
export async function readChatStream(res: Response, onEvent: (evt: Record<string, unknown>) => void): Promise<void> {
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line));
    }
  }
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
