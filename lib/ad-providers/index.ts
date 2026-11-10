import { standinProvider } from "./standin";
import type { AdProvider } from "./types";

export type { AdProvider } from "./types";

/** The provider the app plays. Swap this one line (or branch on the session's provider) when a real network arrives. */
export function adProviderFor(id: string): AdProvider {
  void id;
  return standinProvider;
}
