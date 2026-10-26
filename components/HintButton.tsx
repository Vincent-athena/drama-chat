"use client";

import { useState } from "react";

const MAX_LEVEL = 3;
const LABELS = ["💡 Need a hint?", "More direct hint", "Just tell me what to do"];

/** Asks for a hint about the current chapter; each click gets more direct, up to MAX_LEVEL. */
export default function HintButton({ storyId }: { storyId: string }) {
  const [hints, setHints] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/stories/${storyId}/hint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level: hints.length + 1 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setHints((h) => [...h, d.hint]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not get a hint");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="text-sm">
      {hints.length > 0 && (
        <ol className="mb-2 space-y-2">
          {hints.map((h, i) => (
            <li key={i} className="rounded-lg border border-gold-500/20 bg-black/30 px-3 py-2 text-white/80">
              💡 {h}
            </li>
          ))}
        </ol>
      )}
      {error && <p className="mb-1 text-blood-500">{error}</p>}
      {hints.length < MAX_LEVEL && (
        <button onClick={ask} disabled={loading} className="text-gold-500 hover:text-gold-400 disabled:opacity-60">
          {loading ? "Thinking…" : LABELS[hints.length]}
        </button>
      )}
    </div>
  );
}
