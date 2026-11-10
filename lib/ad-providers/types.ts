/** The seam between the app and an ad network. Types only, plus the stand-in's server check. */
import type React from "react";
import type { AdGoogleConfig, AdShown } from "../api-types";

/**
 * Browser side: a component that plays one ad. `onFinished` means the viewer reached the end (the server
 * still decides whether the reward is granted); `onCancel` means they left early. A real network replaces
 * the stand-in by providing another AdProvider; the modal's callers do not change.
 */
export type AdProvider = {
  id: "standin" | "google";
  label: string;
  Component: React.ComponentType<{
    minSeconds: number;
    google?: AdGoogleConfig;
    /** `shown` says what played: a network ad or the house ad. The server records it but does not trust it. */
    onFinished(shown: AdShown): void;
    onCancel(): void;
  }>;
};

/**
 * Server side slot for a later network: confirms from provider evidence (e.g. a signed callback) that the ad
 * was watched. No public route calls it this round; the stand-in's whole check is the elapsed-time rule.
 */
export interface AdServerVerifier {
  provider: string;
  verifyCompletion(session: { id: string; userId: number; startedAt: number }, evidence: unknown): Promise<boolean>;
}

export const standinVerifier: AdServerVerifier = {
  provider: "standin",
  verifyCompletion: async () => true,
};

/**
 * Not wired up yet. Google offers optional server-side verification (SSV) for rewarded web: with an SSV URL
 * set on the ad unit, Google's servers call it when a viewer completes the ad. Until a callback route exists
 * and is checked here, nothing confirms the ad was seen; the only server checks are the ones
 * `completeAdSession` applies to every provider: owner, unused, the elapsed-time floor and the daily cap.
 */
export const googleVerifier: AdServerVerifier = {
  provider: "google",
  verifyCompletion: async () => true,
};
