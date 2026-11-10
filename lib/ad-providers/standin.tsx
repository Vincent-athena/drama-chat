"use client";

import { useEffect, useState } from "react";
import type { AdProvider } from "./types";

/** The placeholder ad: a labelled house card with a countdown. The countdown is cosmetic; the server checks the time. */
function StandinAd({ minSeconds, onFinished, onCancel }: { minSeconds: number; onFinished(): void; onCancel(): void }) {
  const [left, setLeft] = useState(minSeconds);

  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-stage-950 p-4">
      <button onClick={onCancel} className="absolute right-2 top-2 p-2 text-sm text-white/60 underline hover:text-white">
        Close
      </button>
      <div className="w-full max-w-md rounded-2xl border border-gold-500/30 bg-stage-900 p-8 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-white/50">Placeholder ad — real ads come later</p>
        <p className="mt-6 text-6xl">🎭</p>
        <h2 className="mt-3 font-serif text-3xl text-gold-400">House ad</h2>
        <p className="mt-2 text-white/70">Thank you for supporting Drama Chat. Stay for the whole ad to claim your reward.</p>
        <p className="mt-6 text-sm text-white/50" aria-live="polite">
          {left > 0 ? `Reward in ${left}s` : "Your reward is ready"}
        </p>
        <button
          disabled={left > 0}
          onClick={onFinished}
          className="mt-4 rounded-lg bg-gold-500 px-5 py-2 font-semibold text-stage-950 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Claim reward
        </button>
      </div>
    </div>
  );
}

export const standinProvider: AdProvider = { id: "standin", label: "Placeholder ad", Component: StandinAd };
