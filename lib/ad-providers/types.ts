/** The seam between the app and an ad network. Types only, plus the stand-in's server check. */
import type React from "react";

/**
 * Browser side: a component that plays one ad. `onFinished` means the viewer reached the end (the server
 * still decides whether the reward is granted); `onCancel` means they left early. A real network replaces
 * the stand-in by providing another AdProvider; the modal's callers do not change.
 */
export type AdProvider = {
  id: "standin";
  label: string;
  Component: React.ComponentType<{ minSeconds: number; onFinished(): void; onCancel(): void }>;
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
