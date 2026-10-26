"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GenerateStoryModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [premise, setPremise] = useState("");
  const [numPhases, setNumPhases] = useState(4);
  const [numCharacters, setNumCharacters] = useState(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stories/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ premise, numPhases, numCharacters }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      router.push(`/story/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={loading ? undefined : onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg animate-rise rounded-2xl border border-gold-500/30 bg-stage-900 p-6"
      >
        <h2 className="font-serif text-2xl text-gold-400">Write a new drama</h2>
        <p className="mt-1 text-sm text-white/60">DeepSeek will invent the cast, chapters, and secrets.</p>
        <label className="mt-5 block text-sm text-white/70">Premise</label>
        <textarea
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          rows={4}
          placeholder="e.g. A K-drama style revenge story set in a Seoul chaebol family… (leave empty for a surprise)"
          className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-3 text-sm outline-none focus:border-gold-500"
        />
        <div className="mt-4 grid grid-cols-2 gap-4">
          <label className="text-sm text-white/70">
            Chapters
            <input
              type="number" min={2} max={8} value={numPhases}
              onChange={(e) => setNumPhases(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-2 outline-none focus:border-gold-500"
            />
          </label>
          <label className="text-sm text-white/70">
            Characters
            <input
              type="number" min={3} max={12} value={numCharacters}
              onChange={(e) => setNumCharacters(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 p-2 outline-none focus:border-gold-500"
            />
          </label>
        </div>
        {error && <p className="mt-4 text-sm text-blood-500">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={loading} className="px-4 py-2 text-sm text-white/60 hover:text-white">
            Cancel
          </button>
          <button
            type="submit" disabled={loading}
            className="rounded-lg bg-blood-500 px-5 py-2 text-sm font-semibold hover:bg-blood-600 disabled:opacity-60"
          >
            {loading ? "Writing the script… (up to a minute)" : "Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}
