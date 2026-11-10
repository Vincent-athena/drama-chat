import { googleProvider } from "./google";
import { standinProvider } from "./standin";
import type { AdProvider } from "./types";

export type { AdProvider } from "./types";

/** The provider that plays a session: Google when the session says so, the stand-in otherwise. */
export function adProviderFor(id: string): AdProvider {
  return id === "google" ? googleProvider : standinProvider;
}
