"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AdGoogleConfig, AdShown } from "../api-types";
import { loadGpt, playRewarded } from "./google-rewarded";
import { StandinAd } from "./standin";
import type { AdProvider } from "./types";

type Props = { minSeconds: number; google?: AdGoogleConfig; onFinished(shown: AdShown): void; onCancel(): void };

/** Plays one Google rewarded ad. Nothing from Google loads until this component mounts for a google session. */
function GoogleAd({ minSeconds, google, onFinished, onCancel }: Props) {
  const [state, setState] = useState<"waiting" | "nofill">("waiting");
  const cb = useRef({ onFinished, onCancel });
  cb.current = { onFinished, onCancel };
  const path = google?.adUnitPath;

  useEffect(() => {
    // Strict mode mounts twice: the cleanup disposes the first run before it can define a slot.
    if (!path) return setState("nofill");
    let play: ReturnType<typeof playRewarded> | null = null;
    const gt = loadGpt(window as never, () => play?.fail());
    play = playRewarded(gt, path, (o) => {
      if (o === "network") cb.current.onFinished("network");
      else if (o === "cancel") cb.current.onCancel();
      else setState("nofill");
    });
    return () => play?.dispose();
  }, [path]);

  if (state === "nofill") {
    if (google?.noFill === "deny") {
      return (
        <Overlay onClose={onCancel}>
          <p className="text-white/80">No ad is available right now. Please try again later.</p>
        </Overlay>
      );
    }
    return <StandinAd fallback minSeconds={minSeconds} onFinished={onFinished} onCancel={onCancel} />;
  }
  return (
    <Overlay onClose={onCancel}>
      <p className="font-serif italic text-white/70" aria-live="polite">
        Getting an ad ready…
      </p>
      <p className="mt-6 text-xs text-white/50">
        This ad is served by Google, which may use cookies. See our{" "}
        <Link href="/privacy" target="_blank" rel="noopener" className="underline hover:text-white">
          privacy policy
        </Link>
        .
      </p>
    </Overlay>
  );
}

function Overlay({ onClose, children }: { onClose(): void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-stage-950 p-4 text-center">
      <button onClick={onClose} className="absolute right-2 top-2 p-2 text-sm text-white/60 underline hover:text-white">
        Close
      </button>
      <div className="max-w-sm">{children}</div>
    </div>
  );
}

export const googleProvider: AdProvider = { id: "google", label: "Google rewarded ad", Component: GoogleAd };
