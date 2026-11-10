"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GenerateProgress, GenerateStreamEvent } from "@/lib/api-types";
import { apiFetch, readNdjson } from "@/lib/client/api";

function stageLabel(p: GenerateProgress | null): string {
  if (!p) return "Starting…";
  if (p.stage === "outline") return p.attempt && p.attempt > 1 ? `Rewriting the outline (try ${p.attempt})…` : "Writing the outline…";
  if (p.stage === "characters") return `Writing characters ${p.done ?? 0}/${p.total ?? "?"}…`;
  return "Checking the script…";
}

export default function GenerateStoryModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [premise, setPremise] = useState("");
  const [numPhases, setNumPhases] = useState(4);
  const [numCharacters, setNumCharacters] = useState(6);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setProgress(null);
    try {
      const res = await apiFetch("/api/stories/generate", { method: "POST", json: { premise, numPhases, numCharacters } });
      let id: string | null = null;
      let failure: string | null = null;
      await readNdjson<GenerateStreamEvent>(res, (evt) => {
        if (evt.type === "progress") setProgress({ stage: evt.stage, attempt: evt.attempt, done: evt.done, total: evt.total });
        else if (evt.type === "done") id = evt.id;
        else if (evt.type === "error") failure = evt.message;
      });
      if (failure) throw new Error(failure);
      if (!id) throw new Error("Generation was interrupted. Please try again.");
      router.push(`/story/${id}`);
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
        <p className="mt-1 text-sm text-white/60">The AI will invent the cast, chapters, and secrets.</p>
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
            {loading ? stageLabel(progress) : "Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}
